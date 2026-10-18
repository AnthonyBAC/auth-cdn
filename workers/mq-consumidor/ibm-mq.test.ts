// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ConsumerConfig } from "./configuracion";
import type { ClienteMq } from "./conexion";
import { crearReceptorMq } from "./ibm-mq";

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
} as ConsumerConfig;

const MQC = {
  MQCNO_CLIENT_BINDING: 1,
  MQCNO_RECONNECT_DISABLED: 2,
  MQOT_Q: 1,
  MQOO_INPUT_AS_Q_DEF: 16,
  MQOO_FAIL_IF_QUIESCING: 8192,
  MQGMO_SYNCPOINT: 1,
  MQGMO_WAIT: 4,
  MQGMO_CONVERT: 8192,
  MQGMO_FAIL_IF_QUIESCING: 16384,
  MQRC_NO_MSG_AVAILABLE: 2033,
};

class Estructura {}

function errorMq(mqrc: number) {
  return Object.assign(new Error(`MQRC ${mqrc}`), { mqrc });
}

function setup() {
  const mq = {
    MQC,
    MQCNO: Estructura, MQCD: Estructura, MQSCO: Estructura, MQCSP: Estructura,
    MQOD: Estructura, MQMD: Estructura, MQGMO: Estructura,
    ConnxPromise: vi.fn().mockResolvedValue("conexion"),
    OpenPromise: vi.fn().mockResolvedValue("cola"),
    GetPromise: vi.fn().mockResolvedValue(Buffer.from("{}")),
    ClosePromise: vi.fn().mockResolvedValue(undefined),
    DiscPromise: vi.fn().mockResolvedValue(undefined),
    Cmit: vi.fn(),
    Back: vi.fn(),
  };
  return { mq, receptor: crearReceptorMq(mq as unknown as ClienteMq, config) };
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
      expect.anything(),
      MQC.MQOO_INPUT_AS_Q_DEF | MQC.MQOO_FAIL_IF_QUIESCING,
    );
    expect(mq.GetPromise).toHaveBeenCalledWith("cola", expect.anything(), expect.objectContaining({
      Options: MQC.MQGMO_SYNCPOINT | MQC.MQGMO_WAIT | MQC.MQGMO_CONVERT | MQC.MQGMO_FAIL_IF_QUIESCING,
      WaitInterval: config.MQ_CONSUMER_WAIT_MS,
    }));
  });

  it("devuelve el cuerpo del mensaje como texto UTF-8", async () => {
    const { mq, receptor } = setup();
    mq.GetPromise.mockResolvedValue(Buffer.from("mensaje secreto", "utf8"));
    await expect(receptor.recibir()).resolves.toEqual({ cuerpo: "mensaje secreto" });
  });

  it("trata 'sin mensaje' como cola vacía y conserva la conexión", async () => {
    const { mq, receptor } = setup();
    mq.GetPromise.mockRejectedValue(errorMq(MQC.MQRC_NO_MSG_AVAILABLE));
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
    mq.GetPromise.mockRejectedValueOnce(errorMq(2009)).mockResolvedValue(Buffer.from("recuperado"));

    await expect(receptor.recibir()).rejects.toThrow();
    expect(mq.ClosePromise).toHaveBeenCalledWith("cola", 0);
    expect(mq.DiscPromise).toHaveBeenCalledWith("conexion");

    await expect(receptor.recibir()).resolves.toEqual({ cuerpo: "recuperado" });
    expect(mq.ConnxPromise).toHaveBeenCalledTimes(2);
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
