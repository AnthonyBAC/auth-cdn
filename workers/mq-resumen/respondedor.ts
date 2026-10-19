import { z } from "zod";

import {
  RESUMEN_SCHEMA_VERSION,
  UUID_DESCONOCIDO,
  calcularEstadisticas,
  resumenRequestSchema,
  type ResumenErrorCode,
  type ResumenReply
} from "../../lib/mq/resumen";
import type { ResumenStore } from "./tablero";

const uuid = z.string().uuid();

export type MensajeSolicitud = {
  cuerpo: string;
  msgId: Buffer;
  replyToQ: string;
  backoutCount: number;
};

// El receptor conserva la transacción MQ abierta entre recibir() y
// confirmar()/revertir(). responder() publica bajo syncpoint en la misma
// unidad de trabajo, de modo que el COMMIT retira la solicitud y publica la
// respuesta de forma atómica.
export interface ReceptorSolicitudes {
  recibir(): Promise<MensajeSolicitud | null>;
  responder(destino: string, correlId: Buffer, cuerpo: string): Promise<void>;
  confirmar(): Promise<void>;
  revertir(): Promise<void>;
  cerrar(): Promise<void>;
}

export type ResultadoCicloResumen =
  | "EMPTY"
  | "OK"
  | "ERROR_REPLY"
  | "DISCARDED"
  | "RETRY";

export type OpcionesRespondedor = {
  maxAttempts: number;
  replyQueue: string;
};

function registrar(nivel: "info" | "warn" | "error", datos: Record<string, unknown>): void {
  const linea = JSON.stringify({ proceso: "resumen-respondedor", nivel, ...datos });
  if (nivel === "error") {
    console.error(linea);
  } else if (nivel === "warn") {
    console.warn(linea);
  } else {
    console.log(linea);
  }
}

function identificadores(payload: unknown): { requestId: string; boardId: string } {
  const object = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const requestId = uuid.safeParse(object.requestId);
  const boardId = uuid.safeParse(object.boardId);
  return {
    requestId: requestId.success ? requestId.data : UUID_DESCONOCIDO,
    boardId: boardId.success ? boardId.data : UUID_DESCONOCIDO
  };
}

function construirRespuestaError(
  requestId: string,
  boardId: string,
  code: ResumenErrorCode,
  message: string,
  now: Date
): ResumenReply {
  return {
    schemaVersion: RESUMEN_SCHEMA_VERSION,
    requestId,
    boardId,
    status: "ERROR",
    generatedAt: now.toISOString(),
    stats: null,
    error: { code, message }
  };
}

async function enviarError(
  receptor: ReceptorSolicitudes,
  mensaje: MensajeSolicitud,
  opciones: OpcionesRespondedor,
  requestId: string,
  boardId: string,
  code: ResumenErrorCode,
  message: string,
  now: Date
): Promise<ResultadoCicloResumen> {
  // Nunca publicar fuera de la cola de respuesta configurada.
  if (mensaje.replyToQ !== opciones.replyQueue || mensaje.msgId.length === 0) {
    await receptor.confirmar();
    registrar("warn", { evento: "respuesta_descartada", motivo: "destino_no_permitido", code });
    return "DISCARDED";
  }

  const reply = construirRespuestaError(requestId, boardId, code, message, now);

  try {
    await receptor.responder(
      opciones.replyQueue,
      Buffer.from(mensaje.msgId),
      JSON.stringify(reply)
    );
  } catch {
    await receptor.revertir();
    return "RETRY";
  }

  try {
    await receptor.confirmar();
  } catch {
    // Resultado incierto. No se revierte: el COMMIT pudo haberse aplicado.
    // Se descarta la conexión para que MQ resuelva la transacción pendiente.
    await receptor.cerrar().catch(() => undefined);
    registrar("error", { evento: "commit_incierto", code });
    return "RETRY";
  }

  registrar("warn", { evento: "respuesta_error", code, requestId, boardId });
  return "ERROR_REPLY";
}

async function gestionarFalloRecuperable(
  receptor: ReceptorSolicitudes,
  mensaje: MensajeSolicitud,
  opciones: OpcionesRespondedor,
  requestId: string,
  boardId: string,
  now: Date
): Promise<ResultadoCicloResumen> {
  const intentos = mensaje.backoutCount + 1;

  if (intentos >= opciones.maxAttempts) {
    registrar("warn", {
      evento: "reintentos_agotados",
      requestId,
      boardId,
      backoutCount: mensaje.backoutCount
    });
    return enviarError(
      receptor,
      mensaje,
      opciones,
      requestId,
      boardId,
      "INTERNAL_ERROR",
      "No se pudo calcular el resumen del tablero.",
      now
    );
  }

  await receptor.revertir();
  registrar("warn", {
    evento: "reintento",
    requestId,
    boardId,
    backoutCount: mensaje.backoutCount
  });
  return "RETRY";
}

// Un ciclo completo: leer, validar contrato, autorizar y consultar en Supabase,
// calcular, publicar la respuesta correlacionada y solo entonces confirmar.
export async function procesarSiguienteResumen(
  receptor: ReceptorSolicitudes,
  store: ResumenStore,
  opciones: OpcionesRespondedor,
  now: Date = new Date()
): Promise<ResultadoCicloResumen> {
  const mensaje = await receptor.recibir();
  if (mensaje === null) return "EMPTY";

  let payload: unknown;
  try {
    payload = JSON.parse(mensaje.cuerpo);
  } catch {
    return enviarError(
      receptor,
      mensaje,
      opciones,
      UUID_DESCONOCIDO,
      UUID_DESCONOCIDO,
      "INVALID_REQUEST",
      "La solicitud no contiene JSON válido.",
      now
    );
  }

  const parsed = resumenRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const ids = identificadores(payload);
    return enviarError(
      receptor,
      mensaje,
      opciones,
      ids.requestId,
      ids.boardId,
      "INVALID_REQUEST",
      "La solicitud no cumple el contrato.",
      now
    );
  }

  const request = parsed.data;
  if (Date.parse(request.expiresAt) <= now.getTime()) {
    return enviarError(
      receptor,
      mensaje,
      opciones,
      request.requestId,
      request.boardId,
      "EXPIRED",
      "La solicitud expiró antes de procesarse.",
      now
    );
  }

  let consulta: Awaited<ReturnType<ResumenStore["consultar"]>>;
  try {
    consulta = await store.consultar(request.boardId, request.userId);
  } catch {
    return gestionarFalloRecuperable(
      receptor,
      mensaje,
      opciones,
      request.requestId,
      request.boardId,
      now
    );
  }

  if (!consulta.ok) {
    return enviarError(
      receptor,
      mensaje,
      opciones,
      request.requestId,
      request.boardId,
      consulta.code,
      consulta.code === "FORBIDDEN"
        ? "El usuario no tiene acceso al tablero."
        : "El tablero no existe o está archivado.",
      now
    );
  }

  const reply: ResumenReply = {
    schemaVersion: RESUMEN_SCHEMA_VERSION,
    requestId: request.requestId,
    boardId: request.boardId,
    status: "OK",
    generatedAt: now.toISOString(),
    stats: calcularEstadisticas(consulta.cards, now)
  };

  if (mensaje.replyToQ !== opciones.replyQueue || mensaje.msgId.length === 0) {
    await receptor.confirmar();
    registrar("warn", { evento: "respuesta_descartada", motivo: "destino_no_permitido", requestId: request.requestId });
    return "DISCARDED";
  }

  try {
    await receptor.responder(opciones.replyQueue, Buffer.from(mensaje.msgId), JSON.stringify(reply));
  } catch {
    return gestionarFalloRecuperable(
      receptor,
      mensaje,
      opciones,
      request.requestId,
      request.boardId,
      now
    );
  }

  try {
    await receptor.confirmar();
  } catch {
    await receptor.cerrar().catch(() => undefined);
    registrar("error", { evento: "commit_incierto", requestId: request.requestId });
    return "RETRY";
  }

  return "OK";
}
