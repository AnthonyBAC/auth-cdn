// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { UUID_DESCONOCIDO, resumenReplySchema } from "../../../domain/resumen";
import {
  procesarSiguienteResumen,
  type MensajeSolicitud,
  type ReceptorSolicitudes
} from "../../../legacy/mq-resumen/respondedor";
import type { ConsultaResumen, ResumenStore } from "../../../infrastructure/tablero";

const ahora = new Date("2026-10-19T12:00:00.000Z");
const boardId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const replyQueue = "AUTHCDN.SUMMARY.REPLY.Q";

const solicitud = {
  schemaVersion: 1,
  requestId,
  boardId,
  userId,
  createdAt: "2026-10-19T11:59:50.000Z",
  expiresAt: "2026-10-19T12:00:10.000Z"
};

function mensaje(cuerpo: unknown, overrides: Partial<MensajeSolicitud> = {}): MensajeSolicitud {
  return {
    cuerpo: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    msgId: Buffer.from("msg-id-solicitud"),
    replyToQ: replyQueue,
    backoutCount: 0,
    ...overrides
  };
}

function receptorFalso(entrada: MensajeSolicitud | null) {
  const enviadas: Array<{ destino: string; correlId: Buffer; cuerpo: string }> = [];
  const llamadas: string[] = [];
  const receptor: ReceptorSolicitudes = {
    async recibir() {
      llamadas.push("recibir");
      return entrada;
    },
    async responder(destino, correlId, cuerpo) {
      llamadas.push("responder");
      enviadas.push({ destino, correlId: Buffer.from(correlId), cuerpo });
    },
    async confirmar() {
      llamadas.push("confirmar");
    },
    async revertir() {
      llamadas.push("revertir");
    },
    async cerrar() {
      llamadas.push("cerrar");
    }
  };
  return { receptor, enviadas, llamadas };
}

function storeFalso(resultado: ConsultaResumen | Error): ResumenStore {
  return {
    consultar: vi.fn(async () => {
      if (resultado instanceof Error) throw resultado;
      return resultado;
    })
  };
}

const opciones = { maxAttempts: 3, replyQueue };

function respuestaEnviada(enviadas: ReturnType<typeof receptorFalso>["enviadas"]) {
  expect(enviadas).toHaveLength(1);
  const reply = resumenReplySchema.parse(JSON.parse(enviadas[0].cuerpo));
  return reply;
}

describe("Respondedor de resúmenes", () => {
  it("calcula, correlaciona por MsgId y confirma después de publicar", async () => {
    const { receptor, enviadas, llamadas } = receptorFalso(mensaje(solicitud));
    const store = storeFalso({
      ok: true,
      cards: [
        { completedAt: null, dueAt: "2026-10-18T12:00:00.000Z" },
        { completedAt: null, dueAt: null },
        { completedAt: "2026-10-19T10:00:00.000Z", dueAt: "2026-10-18T12:00:00.000Z" },
        { completedAt: null, dueAt: "2026-10-20T12:00:00.000Z" }
      ]
    });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("OK");

    expect(llamadas).toEqual(["recibir", "responder", "confirmar"]);
    expect(enviadas[0].destino).toBe(replyQueue);
    expect(enviadas[0].correlId.equals(Buffer.from("msg-id-solicitud"))).toBe(true);
    expect(respuestaEnviada(enviadas)).toMatchObject({
      status: "OK",
      requestId,
      boardId,
      stats: { totalActive: 4, pending: 2, completed: 1, overdue: 1 }
    });
  });

  it("responde un error controlado a un mensaje que no es JSON", async () => {
    const { receptor, enviadas, llamadas } = receptorFalso(mensaje("{no-json"));
    const store = storeFalso({ ok: true, cards: [] });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("ERROR_REPLY");

    expect(store.consultar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "responder", "confirmar"]);
    expect(respuestaEnviada(enviadas)).toMatchObject({
      status: "ERROR",
      requestId: UUID_DESCONOCIDO,
      boardId: UUID_DESCONOCIDO,
      error: { code: "INVALID_REQUEST" }
    });
  });

  it("conserva los identificadores válidos de una solicitud que no cumple el contrato", async () => {
    const { receptor, enviadas } = receptorFalso(mensaje({ ...solicitud, extra: "no permitido" }));
    const store = storeFalso({ ok: true, cards: [] });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("ERROR_REPLY");
    expect(respuestaEnviada(enviadas)).toMatchObject({
      requestId,
      boardId,
      error: { code: "INVALID_REQUEST" }
    });
  });

  it("no consulta ni calcula una solicitud expirada", async () => {
    const { receptor, enviadas } = receptorFalso(mensaje(solicitud));
    const store = storeFalso({ ok: true, cards: [] });

    await expect(
      procesarSiguienteResumen(receptor, store, opciones, new Date("2026-10-19T12:00:10.000Z"))
    ).resolves.toBe("ERROR_REPLY");

    expect(store.consultar).not.toHaveBeenCalled();
    expect(respuestaEnviada(enviadas)).toMatchObject({ error: { code: "EXPIRED" } });
  });

  it("responde FORBIDDEN cuando el usuario perdió la membresía", async () => {
    const { receptor, enviadas } = receptorFalso(mensaje(solicitud));
    const store = storeFalso({ ok: false, code: "FORBIDDEN" });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("ERROR_REPLY");
    expect(respuestaEnviada(enviadas)).toMatchObject({
      requestId,
      boardId,
      error: { code: "FORBIDDEN" }
    });
  });

  it("responde NOT_FOUND cuando el tablero está archivado o no existe", async () => {
    const { receptor, enviadas } = receptorFalso(mensaje(solicitud));
    const store = storeFalso({ ok: false, code: "NOT_FOUND" });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("ERROR_REPLY");
    expect(respuestaEnviada(enviadas)).toMatchObject({
      requestId,
      boardId,
      error: { code: "NOT_FOUND" }
    });
  });

  it("revierte sin responder ante un fallo recuperable", async () => {
    const { receptor, enviadas, llamadas } = receptorFalso(mensaje(solicitud));
    const store = storeFalso(new Error("Supabase no disponible"));

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("RETRY");
    expect(llamadas).toEqual(["recibir", "revertir"]);
    expect(enviadas).toHaveLength(0);
  });

  it("responde INTERNAL_ERROR al agotar los intentos recuperables", async () => {
    const { receptor, enviadas, llamadas } = receptorFalso(
      mensaje(solicitud, { backoutCount: 2 })
    );
    const store = storeFalso(new Error("Supabase no disponible"));

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("ERROR_REPLY");
    expect(llamadas).toEqual(["recibir", "responder", "confirmar"]);
    expect(respuestaEnviada(enviadas)).toMatchObject({
      error: { code: "INTERNAL_ERROR" }
    });
  });

  it("no publica en un destino distinto de la cola de respuesta configurada", async () => {
    const { receptor, enviadas, llamadas } = receptorFalso(
      mensaje(solicitud, { replyToQ: "COLA.NO.PERMITIDA" })
    );
    const store = storeFalso({ ok: true, cards: [] });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("DISCARDED");
    expect(llamadas).toEqual(["recibir", "confirmar"]);
    expect(enviadas).toHaveLength(0);
  });

  it("revierte si la publicación de la respuesta falla", async () => {
    const { receptor, llamadas } = receptorFalso(mensaje(solicitud));
    receptor.responder = vi.fn(async () => {
      llamadas.push("responder");
      throw new Error("MQPUT falló");
    });
    const store = storeFalso({ ok: true, cards: [] });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("RETRY");
    expect(llamadas).toEqual(["recibir", "responder", "revertir"]);
  });

  it("no revierte cuando el COMMIT de la respuesta es incierto", async () => {
    const { receptor, llamadas } = receptorFalso(mensaje(solicitud));
    receptor.confirmar = vi.fn(async () => {
      llamadas.push("confirmar");
      throw new Error("MQCMIT incierto");
    });
    const store = storeFalso({ ok: true, cards: [] });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("RETRY");
    expect(llamadas).toEqual(["recibir", "responder", "confirmar", "cerrar"]);
  });

  it("no confirma ni revierte cuando la cola está vacía", async () => {
    const { receptor, llamadas } = receptorFalso(null);
    const store = storeFalso({ ok: true, cards: [] });

    await expect(procesarSiguienteResumen(receptor, store, opciones, ahora)).resolves.toBe("EMPTY");
    expect(llamadas).toEqual(["recibir"]);
  });
});
