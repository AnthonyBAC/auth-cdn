// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ConsumerConfig } from "../../../legacy/mq-consumidor/configuracion";
import type { ClienteMq } from "../../../legacy/mq-consumidor/conexion";
import {
  crearReceptorMq,
  ErrorCommitIncierto,
  ErrorLecturaNoConservable,
} from "../../../legacy/mq-consumidor/ibm-mq";

const config = {
  MQ_QUEUE_MANAGER: "QM1",
  MQ_QUEUE: "AVISOS",
  MQ_CHANNEL: "APP.TLS",
  MQ_CONNECTION_NAME: "localhost(1414)",
  MQ_USERNAME: "consumer",
  MQ_PASSWORD: "secreto",
  MQ_TLS_CIPHER_SPEC: "TLS_AES_256_GCM_SHA384",
  MQ_TLS_PEER_NAME: "CN=broker",
  MQ_TLS_KEY_REPOSITORY: "/certs/key",
  MQ_CONSUMER_WAIT_MS: 5000,
  MQ_CONSUMER_INTERVAL_MS: 5000,
  MQ_BACKOUT_QUEUE: "AUTHCDN.REMINDERS.BOQ",
  MQ_BACKOUT_THRESHOLD: 5,
} as ConsumerConfig;

const MQC = {
  MQCNO_CLIENT_BINDING: 1,
  MQCNO_RECONNECT_DISABLED: 2,
  MQOT_Q: 1,
  MQOO_INPUT_AS_Q_DEF: 16,
  MQOO_OUTPUT: 32,
  MQOO_FAIL_IF_QUIESCING: 8192,
  MQGMO_SYNCPOINT: 1,
  MQGMO_WAIT: 4,
  MQGMO_CONVERT: 8192,
  MQGMO_FAIL_IF_QUIESCING: 16384,
  MQPMO_SYNCPOINT: 1,
  MQPMO_FAIL_IF_QUIESCING: 4096,
  MQPER_PERSISTENT: 1,
  MQPER_NOT_PERSISTENT: 0,
  MQEI_UNLIMITED: -1,
  MQFMT_STRING: "MQSTR",
  MQRC_NO_MSG_AVAILABLE: 2033,
  MQRC_NOT_CONVERTED: 2119,
  MQRC_PARTIALLY_CONVERTED: 2272,
  MQRC_CONVERTED_MSG_TOO_BIG: 2120,
  MQRC_CONVERTED_STRING_TOO_BIG: 2190,
  MQRC_STRING_TRUNCATED: 2311,
  MQRC_SOURCE_CCSID_ERROR: 2111,
  MQRC_TARGET_CCSID_ERROR: 2115,
  MQRC_ENCODING_ERROR: 6106,
  MQRC_TRUNCATED_MSG_FAILED: 2080,
  MQRC_TRUNCATED_MSG_ACCEPTED: 2079,
  MQRC_DATA_LENGTH_ERROR: 2010,
};

class Estructura {}

class MQMDMock {
  BackoutCount = 0;
  MsgId: Buffer = Buffer.from("identificador-original");
  CorrelId: Buffer = Buffer.alloc(0);
  Feedback = 0;
  ApplIdentityData = "";
  Persistence = 0;
  Expiry = 0;
  Format = "";
  CodedCharSetId = 0;
  Encoding = 0;
}

class MQPMOMock {
  Options = 0;
}

class MQODMock {
  ObjectName: string | null = null;
  ObjectType = MQC.MQOT_Q;
}

function errorMq(mqrc: number) {
  return Object.assign(new Error(`MQRC ${mqrc}`), { mqrc });
}

function setup() {
  const mq = {
    MQC,
    MQCNO: Estructura, MQCD: Estructura, MQSCO: Estructura, MQCSP: Estructura,
    MQOD: MQODMock, MQMD: MQMDMock, MQGMO: Estructura, MQPMO: MQPMOMock,
    ConnxPromise: vi.fn().mockResolvedValue("conexion"),
    OpenPromise: vi.fn(async (_conexion: unknown, od: { ObjectName?: string | null }) =>
      od?.ObjectName === config.MQ_BACKOUT_QUEUE ? "boq" : "cola"
    ),
    GetSync: vi.fn((_cola: unknown, md: MQMDMock, _gmo: unknown, buffer: Buffer): number => {
      void _cola; void _gmo; void buffer;
      md.BackoutCount = 0;
      Buffer.from("{}").copy(buffer);
      return 2;
    }),
    PutPromise: vi.fn(
      async (_objeto: unknown, _md: unknown, _pmo: unknown, _cuerpo: string | Buffer) =>
        undefined
    ),
    ClosePromise: vi.fn().mockResolvedValue(undefined),
    DiscPromise: vi.fn().mockResolvedValue(undefined),
    Cmit: vi.fn(),
    Back: vi.fn(),
  };
  return { mq, receptor: crearReceptorMq(mq as unknown as ClienteMq, config) };
}

// Ajusta el mock de GetSync para devolver un cuerpo y un BackoutCount concretos.
function simularGet(
  mq: ReturnType<typeof setup>["mq"],
  cuerpo: string | Buffer,
  backoutCount = 0,
) {
  const datos = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, "utf8");
  mq.GetSync.mockImplementation((_cola, md, _gmo, buffer) => {
    md.BackoutCount = backoutCount;
    datos.copy(buffer);
    return datos.length;
  });
}

describe("Receptor IBM MQ (simulado)", () => {
  it("conecta con TLS y abre la cola para lectura transaccional", async () => {
    const { mq, receptor } = setup();
    await receptor.recibir();

    expect(mq.ConnxPromise).toHaveBeenCalledWith(config.MQ_QUEUE_MANAGER, expect.objectContaining({
      Options: MQC.MQCNO_CLIENT_BINDING | MQC.MQCNO_RECONNECT_DISABLED,
      ClientConn: expect.objectContaining({
        ChannelName: config.MQ_CHANNEL,
        ConnectionName: config.MQ_CONNECTION_NAME,
        SSLCipherSpec: config.MQ_TLS_CIPHER_SPEC,
        SSLPeerName: config.MQ_TLS_PEER_NAME,
      }),
      SSLConfig: expect.objectContaining({ KeyRepository: config.MQ_TLS_KEY_REPOSITORY }),
      SecurityParms: expect.objectContaining({ UserId: config.MQ_USERNAME, Password: config.MQ_PASSWORD }),
    }));
    expect(mq.OpenPromise).toHaveBeenCalledWith(
      "conexion",
      expect.objectContaining({ ObjectName: config.MQ_QUEUE }),
      MQC.MQOO_INPUT_AS_Q_DEF | MQC.MQOO_FAIL_IF_QUIESCING,
    );
    expect(mq.GetSync).toHaveBeenCalledWith("cola", expect.anything(), expect.objectContaining({
      Options: MQC.MQGMO_SYNCPOINT | MQC.MQGMO_WAIT | MQC.MQGMO_CONVERT | MQC.MQGMO_FAIL_IF_QUIESCING,
      WaitInterval: config.MQ_CONSUMER_WAIT_MS,
    }), expect.any(Buffer));
  });

  it("devuelve el cuerpo del mensaje como texto UTF-8 y su BackoutCount", async () => {
    const { mq, receptor } = setup();
    simularGet(mq, "mensaje secreto", 2);
    await expect(receptor.recibir()).resolves.toEqual({ cuerpo: "mensaje secreto", backoutCount: 2 });
  });

  it("trata 'sin mensaje' como cola vacía y conserva la conexión", async () => {
    const { mq, receptor } = setup();
    mq.GetSync.mockImplementation(() => {
      throw errorMq(MQC.MQRC_NO_MSG_AVAILABLE);
    });
    await expect(receptor.recibir()).resolves.toBeNull();
    expect(mq.DiscPromise).not.toHaveBeenCalled();
    expect(mq.ClosePromise).not.toHaveBeenCalled();
  });

  it("confirma con Cmit sobre la conexión abierta", async () => {
    const { mq, receptor } = setup();
    await receptor.recibir();
    await receptor.confirmar();
    expect(mq.Cmit).toHaveBeenCalledWith("conexion");
    expect(mq.Back).not.toHaveBeenCalled();
  });

  it("revierte con Back sin confirmar", async () => {
    const { mq, receptor } = setup();
    await receptor.recibir();
    await receptor.revertir();
    expect(mq.Back).toHaveBeenCalledWith("conexion");
    expect(mq.Cmit).not.toHaveBeenCalled();
  });

  it("no permite confirmar ni revertir sin conexión", async () => {
    const { receptor } = setup();
    await expect(receptor.confirmar()).rejects.toThrow(/No hay conexión/);
    await expect(receptor.revertir()).rejects.toThrow(/No hay conexión/);
  });

  it("descarta la conexión y reconecta tras un error de lectura", async () => {
    const { mq, receptor } = setup();
    mq.GetSync
      .mockImplementationOnce(() => {
        throw errorMq(2009);
      });
    simularGet(mq, "recuperado");

    await expect(receptor.recibir()).rejects.toThrow();
    expect(mq.ClosePromise).toHaveBeenCalledWith("cola", 0);
    expect(mq.DiscPromise).toHaveBeenCalledWith("conexion");

    await expect(receptor.recibir()).resolves.toEqual({ cuerpo: "recuperado", backoutCount: 0 });
    expect(mq.ConnxPromise).toHaveBeenCalledTimes(2);
  });

  it("traslada a la BOQ sobre la misma conexión y transacción con un único COMMIT", async () => {
    const { mq, receptor } = setup();
    const mensaje = await receptor.recibir();

    await receptor.moverABoq(mensaje!, {
      motivo: "ERROR_PERMANENTE",
      backoutCount: mensaje!.backoutCount,
    });

    // La BOQ se abre en la conexión existente con permiso de escritura.
    expect(mq.OpenPromise).toHaveBeenCalledWith(
      "conexion",
      expect.objectContaining({ ObjectName: config.MQ_BACKOUT_QUEUE }),
      MQC.MQOO_OUTPUT | MQC.MQOO_FAIL_IF_QUIESCING,
    );
    // El PUT se realiza bajo syncpoint.
    expect(mq.PutPromise).toHaveBeenCalledWith(
      "boq",
      expect.anything(),
      expect.objectContaining({ Options: MQC.MQPMO_SYNCPOINT | MQC.MQPMO_FAIL_IF_QUIESCING }),
      expect.any(Buffer),
    );
    // Una sola confirmación, sobre la conexión.
    expect(mq.Cmit).toHaveBeenCalledTimes(1);
    expect(mq.Cmit).toHaveBeenCalledWith("conexion");
    expect(mq.Back).not.toHaveBeenCalled();
  });

  it("no ejecuta COMMIT antes de completar el PUT en la BOQ", async () => {
    const { mq, receptor } = setup();
    let cmitDurantePut = false;

    mq.PutPromise.mockImplementation(async () => {
      cmitDurantePut = mq.Cmit.mock.calls.length > 0;
    });

    const mensaje = await receptor.recibir();
    await receptor.moverABoq(mensaje!, {
      motivo: "REINTENTOS_AGOTADOS",
      backoutCount: mensaje!.backoutCount,
    });

    expect(cmitDurantePut).toBe(false);
    expect(mq.Cmit).toHaveBeenCalledTimes(1);
  });

  it("publica un sobre JSON con el cuerpo recuperable y metadatos de diagnóstico", async () => {
    const { mq, receptor } = setup();
    const original = "recordatorio original";
    simularGet(mq, original, 3);

    const mensaje = await receptor.recibir();
    expect(mensaje).toEqual({ cuerpo: original, backoutCount: 3 });

    await receptor.moverABoq(mensaje!, {
      motivo: "REINTENTOS_AGOTADOS",
      backoutCount: 3,
      eventId: "evt-1",
    });

    const [, md, , cuerpo] = mq.PutPromise.mock.calls[0];
    const sobre = JSON.parse((cuerpo as Buffer).toString("utf8"));

    expect(sobre).toMatchObject({
      formato: "auth-cdn.mq.boq.diagnostico",
      version: 1,
      motivo: "REINTENTOS_AGOTADOS",
      backoutCount: 3,
      eventId: "evt-1",
      colaOrigen: config.MQ_QUEUE,
    });
    expect(sobre.fechaDerivacion).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Buffer.from(sobre.cuerpoBase64, "base64").toString("utf8")).toBe(original);
    expect(sobre.cuerpoBytes).toBe(Buffer.byteLength(original, "utf8"));
    expect(sobre.mensajeOriginal.msgId).toBe(
      Buffer.from("identificador-original").toString("base64")
    );
    expect(sobre.mensajeOriginal.conversionAplicada).toBe(true);

    // El descriptor de la BOQ es persistente, sin expiración y de texto UTF-8.
    expect((md as MQMDMock).Persistence).toBe(MQC.MQPER_PERSISTENT);
    expect((md as MQMDMock).Expiry).toBe(MQC.MQEI_UNLIMITED);
    expect((md as MQMDMock).Format).toBe(MQC.MQFMT_STRING);
    expect((md as MQMDMock).CodedCharSetId).toBe(1208);
    // No se usan campos de contexto que requieran permisos elevados.
    expect((md as MQMDMock).ApplIdentityData).toBe("");
  });

  it("omite el eventId del sobre cuando no es válido", async () => {
    const { mq, receptor } = setup();
    simularGet(mq, "{}", 0);

    const mensaje = await receptor.recibir();
    await receptor.moverABoq(mensaje!, { motivo: "MENSAJE_MALFORMADO", backoutCount: 0 });

    const cuerpo = mq.PutPromise.mock.calls[0][3] as Buffer;
    const sobre = JSON.parse(cuerpo.toString("utf8"));
    expect(sobre.eventId).toBeUndefined();
  });

  it("reintenta sin conversión y conserva los bytes crudos si MQGMO_CONVERT falla", async () => {
    const { mq, receptor } = setup();
    const crudo = Buffer.from("contenido en otro CCSID");

    mq.GetSync.mockImplementationOnce(() => {
      throw errorMq(MQC.MQRC_NOT_CONVERTED);
    });
    mq.GetSync.mockImplementation((_cola, md, _gmo, buffer) => {
      (md as MQMDMock).BackoutCount = 1;
      crudo.copy(buffer);
      return crudo.length;
    });

    const mensaje = await receptor.recibir();
    expect(mensaje).toEqual({ cuerpo: crudo.toString("utf8"), backoutCount: 1 });

    const primeraGmo = mq.GetSync.mock.calls[0][2] as { Options: number };
    const segundaGmo = mq.GetSync.mock.calls[1][2] as { Options: number };
    expect(primeraGmo.Options & MQC.MQGMO_CONVERT).toBe(MQC.MQGMO_CONVERT);
    expect(segundaGmo.Options & MQC.MQGMO_CONVERT).toBe(0);

    await receptor.moverABoq(mensaje!, { motivo: "MENSAJE_MALFORMADO", backoutCount: 1 });
    const sobre = JSON.parse((mq.PutPromise.mock.calls[0][3] as Buffer).toString("utf8"));
    expect(sobre.mensajeOriginal.conversionAplicada).toBe(false);
    expect(Buffer.from(sobre.cuerpoBase64, "base64")).toEqual(crudo);
  });

  it("falla de forma acotada sin descartar un mensaje que excede el buffer", async () => {
    const { mq, receptor } = setup();
    mq.GetSync.mockImplementation(() => {
      throw errorMq(MQC.MQRC_TRUNCATED_MSG_FAILED);
    });

    await expect(receptor.recibir()).rejects.toThrow(ErrorLecturaNoConservable);
    // Plan acotado: conversión, crudo y buffer ampliado (3 intentos como máximo).
    expect(mq.GetSync).toHaveBeenCalledTimes(3);
    expect(mq.Cmit).not.toHaveBeenCalled();
    expect(mq.Back).not.toHaveBeenCalled();
  });

  it("marca incertidumbre y no revierte si el COMMIT del traslado falla", async () => {
    const { mq, receptor } = setup();
    mq.Cmit.mockImplementation(() => {
      throw errorMq(2009);
    });
    const mensaje = await receptor.recibir();

    await expect(
      receptor.moverABoq(mensaje!, { motivo: "ERROR_PERMANENTE", backoutCount: 0 }),
    ).rejects.toThrow(ErrorCommitIncierto);

    // Un COMMIT incierto no autoriza a afirmar un fallo definitivo ni a reintentar.
    expect(mq.Back).not.toHaveBeenCalled();
    expect(mq.DiscPromise).toHaveBeenCalledWith("conexion");
  });

  it("revierte el original si falla la publicación en la BOQ y no confirma", async () => {
    const { mq, receptor } = setup();
    mq.PutPromise.mockRejectedValue(errorMq(2009));
    const mensaje = await receptor.recibir();

    await expect(
      receptor.moverABoq(mensaje!, { motivo: "MENSAJE_MALFORMADO", backoutCount: 0 }),
    ).rejects.toThrow();

    expect(mq.Cmit).not.toHaveBeenCalled();
    expect(mq.Back).toHaveBeenCalledWith("conexion");
  });

  it("cierra la cola principal y la BOQ al finalizar", async () => {
    const { mq, receptor } = setup();
    const mensaje = await receptor.recibir();
    await receptor.moverABoq(mensaje!, { motivo: "ERROR_PERMANENTE", backoutCount: 0 });

    await receptor.cerrar();
    expect(mq.ClosePromise).toHaveBeenCalledWith("cola", 0);
    expect(mq.ClosePromise).toHaveBeenCalledWith("boq", 0);
    expect(mq.ClosePromise).toHaveBeenCalledTimes(2);
    expect(mq.DiscPromise).toHaveBeenCalledTimes(1);
  });

  it("cierra la cola y desconecta, y es idempotente", async () => {
    const { mq, receptor } = setup();
    await receptor.recibir();
    await receptor.cerrar();
    expect(mq.ClosePromise).toHaveBeenCalledWith("cola", 0);
    expect(mq.DiscPromise).toHaveBeenCalledWith("conexion");

    await receptor.cerrar();
    expect(mq.ClosePromise).toHaveBeenCalledTimes(1);
    expect(mq.DiscPromise).toHaveBeenCalledTimes(1);
  });

  it("propaga el fallo de conexión sin dejar recursos abiertos", async () => {
    const { mq, receptor } = setup();
    mq.ConnxPromise.mockRejectedValue(new Error("sin conexión"));
    await expect(receptor.recibir()).rejects.toThrow("sin conexión");
    expect(mq.OpenPromise).not.toHaveBeenCalled();
    expect(mq.ClosePromise).not.toHaveBeenCalled();
    expect(mq.DiscPromise).not.toHaveBeenCalled();
  });

  it("cierra la conexión si falla la apertura de la cola", async () => {
    const { mq, receptor } = setup();
    mq.OpenPromise.mockRejectedValue(new Error("sin cola"));
    await expect(receptor.recibir()).rejects.toThrow("sin cola");
    expect(mq.DiscPromise).toHaveBeenCalledWith("conexion");
    expect(mq.ClosePromise).not.toHaveBeenCalled();
  });
});
