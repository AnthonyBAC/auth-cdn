import type { ReminderEvent } from "../../lib/mq/contrato";
import { validarMensaje } from "./validar-mensaje";

// Motivo por el que un mensaje se deriva a la Backout Queue. Se persiste como
// metadato de diagnóstico en el descriptor MQMD del mensaje trasladado.
export type MotivoBoq =
  | "MENSAJE_MALFORMADO"
  | "ERROR_PERMANENTE"
  | "REINTENTOS_AGOTADOS";

export interface DiagnosticoBoq {
  motivo: MotivoBoq;
  backoutCount: number;
  eventId?: string;
}

export interface MensajeRecibido {
  cuerpo: string;
  // Veces que el mensaje ha sido devuelto a la cola antes de esta entrega.
  backoutCount: number;
}

// Contrato mínimo que separa la recepción MQ del procesamiento de negocio.
export interface ReceptorMensajes {
  recibir(): Promise<MensajeRecibido | null>;

  // Confirma la lectura bajo syncpoint (COMMIT).
  confirmar(): Promise<void>;

  // Devuelve el mensaje a la cola para reintento (ROLLBACK).
  revertir(): Promise<void>;

  // Traslada el mensaje a la Backout Queue dentro de la misma transacción:
  // GET original + PUT en la BOQ + un único COMMIT.
  moverABoq(
    mensaje: MensajeRecibido,
    diagnostico: DiagnosticoBoq
  ): Promise<void>;

  cerrar(): Promise<void>;
}

// Resultado explícito del procesamiento. Los nombres coinciden con los desenlaces
// persistidos por la función SQL `process_reminder_event`; solo RETRYABLE_ERROR
// representa un fallo temporal que exige reintento.
export type ResultadoProcesamiento =
  | "PROCESSED"
  | "ALREADY_PROCESSED"
  | "CANCELLED"
  | "EXPIRED"
  | "RETRYABLE_ERROR"
  | "PERMANENT_ERROR";

export interface ProcesadorAviso {
  procesar(event: ReminderEvent): Promise<ResultadoProcesamiento>;
}

export type ResultadoCiclo =
  | "EMPTY"
  | "DISCARDED"
  | "BACKOUT"
  | ResultadoProcesamiento;

// Log estructurado sin secretos. Se usa para errores recuperables, reintentos
// agotados y traslados a la Backout Queue.
function registrar(nivel: "warn" | "error", datos: Record<string, unknown>): void {
  const linea = JSON.stringify({ proceso: "consumidor", nivel, ...datos });

  if (nivel === "error") {
    console.error(linea);
  } else {
    console.warn(linea);
  }
}

// Decide entre reintentar (ROLLBACK) o derivar a la Backout Queue cuando se
// agotan los intentos. El umbral es el número máximo de intentos permitidos.
async function gestionarFallo(
  receptor: ReceptorMensajes,
  mensaje: MensajeRecibido,
  eventId: string | undefined,
  umbralBackout: number,
): Promise<ResultadoCiclo> {
  const intentos = mensaje.backoutCount + 1;

  if (intentos >= umbralBackout) {
    await receptor.moverABoq(mensaje, {
      motivo: "REINTENTOS_AGOTADOS",
      backoutCount: mensaje.backoutCount,
      eventId,
    });
    registrar("warn", {
      evento: "reintentos_agotados",
      eventId,
      backoutCount: mensaje.backoutCount,
      umbral: umbralBackout,
    });
    return "BACKOUT";
  }

  await receptor.revertir();
  registrar("warn", {
    evento: "reintento",
    eventId,
    backoutCount: mensaje.backoutCount,
    umbral: umbralBackout,
  });
  return "RETRYABLE_ERROR";
}

// Un ciclo: leer, validar el contrato y solo entonces confirmar, revertir o
// derivar a la Backout Queue. Nunca se confirma el mensaje antes de que el
// procesador termine: si el procesamiento requiere persistencia, esta ocurre
// dentro de `procesar()`.
export async function procesarSiguiente(
  receptor: ReceptorMensajes,
  procesador: ProcesadorAviso,
  now: Date = new Date(),
  umbralBackout: number = 5,
): Promise<ResultadoCiclo> {
  const mensaje = await receptor.recibir();
  if (mensaje === null) return "EMPTY";

  const validacion = validarMensaje(mensaje.cuerpo, now);

  if (!validacion.ok) {
    if (validacion.reason === "EXPIRED") {
      // Expiración legítima: es un desenlace de negocio esperado, no un fallo.
      // Se descarta sin enviarlo a la Backout Queue.
      await receptor.confirmar();
      return "DISCARDED";
    }

    // JSON malformado o contrato inválido: se conserva en la Backout Queue.
    await receptor.moverABoq(mensaje, {
      motivo: "MENSAJE_MALFORMADO",
      backoutCount: mensaje.backoutCount,
    });
    registrar("warn", {
      evento: "boq",
      motivo: "MENSAJE_MALFORMADO",
      backoutCount: mensaje.backoutCount,
    });
    return "BACKOUT";
  }

  let resultado: ResultadoProcesamiento;
  try {
    resultado = await procesador.procesar(validacion.event);
  } catch {
    // Error recuperable: se reintenta o se agota el umbral.
    return gestionarFallo(receptor, mensaje, validacion.event.eventId, umbralBackout);
  }

  if (resultado === "RETRYABLE_ERROR") {
    return gestionarFallo(receptor, mensaje, validacion.event.eventId, umbralBackout);
  }

  if (resultado === "PERMANENT_ERROR") {
    // Fallo no reintentable: se conserva en la Backout Queue.
    await receptor.moverABoq(mensaje, {
      motivo: "ERROR_PERMANENTE",
      backoutCount: mensaje.backoutCount,
      eventId: validacion.event.eventId,
    });
    registrar("warn", {
      evento: "boq",
      motivo: "ERROR_PERMANENTE",
      eventId: validacion.event.eventId,
      backoutCount: mensaje.backoutCount,
    });
    return "BACKOUT";
  }

  // Desenlaces terminales. En PROCESSED el resultado ya quedó persistido por el
  // procesador (RPC atómica) antes de confirmar el mensaje.
  await receptor.confirmar();
  return resultado;
}
