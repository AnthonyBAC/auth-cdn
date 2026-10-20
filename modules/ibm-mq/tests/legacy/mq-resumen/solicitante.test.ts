// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { ClienteMq } from "../../../legacy/mq-resumen/ibm-mq";
import {
  crearSolicitanteMq,
  ErrorMqResumen,
  ErrorRespuestaResumen,
  ErrorTimeoutResumen,
  type ConfiguracionSolicitud
} from "../../../legacy/mq-resumen/solicitante";

const boardA = "11111111-1111-4111-8111-111111111111";
const boardB = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const config: ConfiguracionSolicitud = {
  MQ_QUEUE_MANAGER: "QM1",
  MQ_CHANNEL: "APP.TLS",
  MQ_CONNECTION_NAME: "localhost(1414)",
  MQ_TLS_CIPHER_SPEC: "TLS_AES_256_GCM_SHA384",
  MQ_TLS_PEER_NAME: "CN=broker",
  MQ_TLS_KEY_REPOSITORY: "/certs/key",
  MQ_SUMMARY_REQUEST_QUEUE: "AUTHCDN.SUMMARY.REQUEST.Q",
  MQ_SUMMARY_REPLY_QUEUE: "AUTHCDN.SUMMARY.REPLY.Q",
  MQ_PRODUCER_USERNAME: "producer",
  MQ_PRODUCER_PASSWORD: "secreto",
  MQ_SUMMARY_TIMEOUT_MS: 200,
  MQ_SUMMARY_REQUEST_TTL_MS: 1000
};

const MQC = {
  MQCNO_CLIENT_BINDING: 1,
  MQCNO_RECONNECT_DISABLED: 2,
  MQOT_Q: 3,
  MQOO_OUTPUT: 4,
  MQOO_INPUT_AS_Q_DEF: 5,
  MQOO_FAIL_IF_QUIESCING: 6,
  MQPER_PERSISTENT: 7,
  MQFMT_STRING: "MQSTR",
  MQPMO_SYNCPOINT: 8,
  MQPMO_SYNC_RESPONSE: 9,
  MQPMO_NEW_MSG_ID: 10,
  MQPMO_FAIL_IF_QUIESCING: 11,
  MQGMO_SYNCPOINT: 12,
  MQGMO_WAIT: 13,
  MQGMO_CONVERT: 14,
  MQGMO_FAIL_IF_QUIESCING: 15,
  MQMO_MATCH_CORREL_ID: 16,
  MQRC_NO_MSG_AVAILABLE: 2033
};

class Estructura {}
class MQMDMock {
  Persistence = 0;
  Expiry = 0;
  Format = "";
  CodedCharSetId = 0;
  ReplyToQ = "";
  MsgId: Buffer = Buffer.alloc(0);
  CorrelId: Buffer = Buffer.alloc(0);
}
class MQGMOMock {
  Options = 0;
  WaitInterval = 0;
  MatchOptions = 0;
}
class MQPMOMock {
  Options = 0;
}
class MQODMock {
  ObjectName: string | null = null;
  ObjectType = 0;
}

type Handle = { nombre: string; id: number };
type Puesta = {
  objeto: Handle;
  md: MQMDMock;
  pmo: MQPMOMock;
  cuerpo: string;
};

type ModoPut = "ok" | "sin-respuesta" | "invalida" | "desajuste" | "rechazar";

function errorMq(mqrc: number) {
  return Object.assign(new Error(`MQRC ${mqrc}`), { mqrc });
}

function setup(modo: ModoPut = "ok") {
  const respuestas = new Map<string, string[]>();
  const puestas: Puesta[] = [];
  const correlacionesLeidas: string[] = [];
  const estadosGet = new Map<Handle, { activo: boolean; key: string }>();
  let msgId = 0;
  let handleId = 0;

  const mq = {
    MQC,
    MQCNO: Estructura,
    MQCD: Estructura,
    MQSCO: Estructura,
    MQCSP: Estructura,
    MQOD: MQODMock,
    MQMD: MQMDMock,
    MQGMO: MQGMOMock,
    MQPMO: MQPMOMock,
    ConnxPromise: vi.fn().mockResolvedValue("conexion"),
    OpenPromise: vi.fn(async (_conexion: unknown, od: MQODMock) => ({
      nombre: od.ObjectName ?? "",
      id: ++handleId
    })),
    PutPromise: vi.fn(async (objeto: Handle, md: MQMDMock, pmo: MQPMOMock, cuerpo: string | Buffer) => {
      if (modo === "rechazar") throw errorMq(2009);
      const texto = Buffer.isBuffer(cuerpo) ? cuerpo.toString("utf8") : cuerpo;
      puestas.push({ objeto, md, pmo, cuerpo: texto });
      md.MsgId = Buffer.from(`msg-${++msgId}`);
      if (modo === "sin-respuesta") return;

      const request = JSON.parse(texto) as { requestId: string; boardId: string };
      const key = md.MsgId.toString("hex");
      const respuestaValida = JSON.stringify({
        schemaVersion: 1,
        requestId: request.requestId,
        boardId: request.boardId,
        status: "OK",
        generatedAt: new Date().toISOString(),
        stats: { totalActive: 0, pending: 0, completed: 0, overdue: 0 }
      });

      const cola = respuestas.get(key) ?? [];
      if (modo === "invalida") {
        cola.push("{no-json");
      } else if (modo === "desajuste") {
        cola.push(JSON.stringify({
          ...JSON.parse(respuestaValida),
          requestId: "99999999-9999-4999-8999-999999999999"
        }));
        cola.push(respuestaValida);
      } else {
        cola.push(respuestaValida);
      }
      respuestas.set(key, cola);
    }),
    GetSync: vi.fn(),
    Get: vi.fn(
      (
        handle: Handle,
        md: MQMDMock,
        gmo: MQGMOMock,
        cb: (
          err: { mqrc?: number } | null,
          objeto: unknown,
          gmo: unknown,
          md: unknown,
          data: Buffer | null,
          gestor: unknown
        ) => void
      ) => {
        if (gmo.MatchOptions !== MQC.MQMO_MATCH_CORREL_ID) {
          setTimeout(() => cb(errorMq(2009), handle, gmo, md, null, "conexion"), 0);
          return;
        }

        const estado = { activo: true, key: md.CorrelId.toString("hex") };
        estadosGet.set(handle, estado);

        const entregar = () => {
          if (!estado.activo) return;
          correlacionesLeidas.push(estado.key);
          const cola = respuestas.get(estado.key);
          if (!cola || cola.length === 0) {
            estado.activo = false;
            cb(errorMq(MQC.MQRC_NO_MSG_AVAILABLE), handle, gmo, md, null, "conexion");
            return;
          }

          const cuerpo = cola.shift()!;
          cb(null, handle, gmo, md, Buffer.from(cuerpo), "conexion");
          if (estado.activo) setTimeout(entregar, 0);
        };

        setTimeout(entregar, 0);
      }
    ),
    GetDone: vi.fn((handle: Handle, cb?: (err: { mqrc?: number } | null) => void) => {
      const estado = estadosGet.get(handle);
      if (estado) estado.activo = false;
      cb?.(null);
    }),
    ClosePromise: vi.fn().mockResolvedValue(undefined),
    DiscPromise: vi.fn().mockResolvedValue(undefined),
    Cmit: vi.fn(),
    Back: vi.fn()
  };

  return { mq, puestas, correlacionesLeidas };
}

describe("Solicitante IBM MQ Request/Reply", () => {
  it("publica con ReplyToQ, MsgId y luego lee por CorrelId", async () => {
    const { mq, puestas, correlacionesLeidas } = setup();
    const solicitante = crearSolicitanteMq(mq as unknown as ClienteMq, config);

    const reply = await solicitante.solicitar({ boardId: boardA, userId });

    expect(reply).toMatchObject({ status: "OK", boardId: boardA });

    expect(puestas).toHaveLength(1);
    expect(puestas[0].objeto.nombre).toBe(config.MQ_SUMMARY_REQUEST_QUEUE);
    expect(puestas[0].md.ReplyToQ).toBe(config.MQ_SUMMARY_REPLY_QUEUE);
    expect(puestas[0].md.Persistence).toBe(MQC.MQPER_PERSISTENT);
    expect(puestas[0].md.Expiry).toBeGreaterThan(0);
    expect(puestas[0].pmo.Options & MQC.MQPMO_SYNC_RESPONSE).toBeTruthy();
    expect(puestas[0].pmo.Options & MQC.MQPMO_NEW_MSG_ID).toBeTruthy();

    expect(correlacionesLeidas).toEqual([puestas[0].md.MsgId.toString("hex")]);
    expect(mq.Cmit).toHaveBeenCalledTimes(2);
    expect(mq.Back).not.toHaveBeenCalled();
  });

  it("mantiene separadas las respuestas de solicitudes concurrentes", async () => {
    const { mq } = setup();
    const solicitante = crearSolicitanteMq(mq as unknown as ClienteMq, config);

    const [a, b] = await Promise.all([
      solicitante.solicitar({ boardId: boardA, userId }),
      solicitante.solicitar({ boardId: boardB, userId })
    ]);

    expect(a.boardId).toBe(boardA);
    expect(b.boardId).toBe(boardB);
    expect(a.requestId).not.toBe(b.requestId);
  });

  it("falla con timeout acotado si no llega la respuesta", async () => {
    const { mq } = setup("sin-respuesta");
    const solicitante = crearSolicitanteMq(mq as unknown as ClienteMq, {
      ...config,
      MQ_SUMMARY_TIMEOUT_MS: 20,
      MQ_SUMMARY_REQUEST_TTL_MS: 100
    });

    await expect(solicitante.solicitar({ boardId: boardA, userId })).rejects.toBeInstanceOf(
      ErrorTimeoutResumen
    );
    expect(mq.Cmit).toHaveBeenCalledTimes(1);
    expect(mq.ClosePromise).toHaveBeenCalled();
    expect(mq.DiscPromise).toHaveBeenCalled();
  });

  it("descarta una respuesta que no cumple el contrato", async () => {
    const { mq } = setup("invalida");
    const solicitante = crearSolicitanteMq(mq as unknown as ClienteMq, config);

    await expect(solicitante.solicitar({ boardId: boardA, userId })).rejects.toBeInstanceOf(
      ErrorRespuestaResumen
    );
    expect(mq.Cmit).toHaveBeenCalledTimes(2);
  });

  it("ignora una respuesta con CorrelId correcto pero contenido ajeno", async () => {
    const { mq, correlacionesLeidas } = setup("desajuste");
    const solicitante = crearSolicitanteMq(mq as unknown as ClienteMq, config);

    const reply = await solicitante.solicitar({ boardId: boardA, userId });

    expect(reply.boardId).toBe(boardA);
    expect(correlacionesLeidas).toHaveLength(2);
    expect(mq.Cmit).toHaveBeenCalledTimes(3);
  });

  it("informa el fallo de conexión sin intentar publicar", async () => {
    const { mq, puestas } = setup();
    mq.ConnxPromise.mockRejectedValue(errorMq(2538));
    const solicitante = crearSolicitanteMq(mq as unknown as ClienteMq, config);

    await expect(solicitante.solicitar({ boardId: boardA, userId })).rejects.toBeInstanceOf(
      ErrorMqResumen
    );
    expect(puestas).toHaveLength(0);
  });

  it("revierte la publicación y falla si MQPUT no se confirma", async () => {
    const { mq } = setup("rechazar");
    const solicitante = crearSolicitanteMq(mq as unknown as ClienteMq, config);

    await expect(solicitante.solicitar({ boardId: boardA, userId })).rejects.toBeInstanceOf(
      ErrorMqResumen
    );
    expect(mq.Back).toHaveBeenCalled();
    expect(mq.DiscPromise).toHaveBeenCalled();
  });
});
