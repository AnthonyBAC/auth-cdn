
// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type * as IBM from "ibmmq";
import { createMqBroker } from "../../../legacy/mq-productor/ibm-mq";
import type { ProducerConfig } from "../../../legacy/mq-productor/configuracion";
import type { ReminderEvent } from "../../../domain/contrato";

const config = {
  MQ_QUEUE_MANAGER: "QM1",
  MQ_QUEUE: "AVISOS",
  MQ_CHANNEL: "APP.TLS",
  MQ_CONNECTION_NAME: "localhost(1414)",

  // Credenciales exclusivas del productor.
  MQ_PRODUCER_USERNAME: "authproducer",
  MQ_PRODUCER_PASSWORD: "test",

  MQ_TLS_CIPHER_SPEC: "ANY_TLS12_OR_HIGHER",
  MQ_TLS_PEER_NAME: "CN=broker",
  MQ_TLS_KEY_REPOSITORY: "/certs/key"
} as ProducerConfig;

const event: ReminderEvent = {
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000001",
  reminderId: "00000000-0000-4000-8000-000000000002",
  cardId: "00000000-0000-4000-8000-000000000003",
  workspaceId: "00000000-0000-4000-8000-000000000004",
  eventType: "TASK_REMINDER_DUE",
  scheduleVersion: 1,
  occurredAt: "2099-01-01T00:00:00Z",
  expiresAt: "2099-01-02T00:00:00Z"
};

function setup() {
  class Structure {}

  const mq = {
    MQC: {
      MQCNO_CLIENT_BINDING: 1,
      MQCNO_RECONNECT_DISABLED: 2,
      MQOT_Q: 1,
      MQOO_OUTPUT: 1,
      MQOO_FAIL_IF_QUIESCING: 2,
      MQPER_PERSISTENT: 1,
      MQFMT_STRING: "MQSTR",
      MQPMO_SYNCPOINT: 1,
      MQPMO_SYNC_RESPONSE: 2,
      MQPMO_NEW_MSG_ID: 4,
      MQPMO_FAIL_IF_QUIESCING: 8
    },

    MQCNO: Structure,
    MQCD: Structure,
    MQSCO: Structure,
    MQCSP: Structure,
    MQOD: Structure,
    MQMD: Structure,
    MQPMO: Structure,

    ConnxPromise: vi.fn().mockResolvedValue("connection"),
    OpenPromise: vi.fn().mockResolvedValue("queue"),
    PutPromise: vi.fn().mockResolvedValue(undefined),
    Cmit: vi.fn(),
    Back: vi.fn(),
    ClosePromise: vi.fn().mockResolvedValue(undefined),
    DiscPromise: vi.fn().mockResolvedValue(undefined)
  };

  return {
    mq,
    broker: createMqBroker(mq as unknown as typeof IBM, config)
  };
}

describe("Adaptador nativo IBM MQ (simulado)", () => {
  it("configura TLS, persistencia y commit después del envío", async () => {
    const { mq, broker } = setup();

    mq.PutPromise.mockImplementation(async () => {
      expect(mq.Cmit).not.toHaveBeenCalled();
    });

    await broker.publish(event);

    expect(mq.ConnxPromise).toHaveBeenCalledWith(
      "QM1",
      expect.objectContaining({
        ClientConn: expect.objectContaining({
          ChannelName: config.MQ_CHANNEL,
          ConnectionName: config.MQ_CONNECTION_NAME,
          SSLCipherSpec: config.MQ_TLS_CIPHER_SPEC,
          SSLPeerName: config.MQ_TLS_PEER_NAME
        }),
        SSLConfig: expect.objectContaining({
          KeyRepository: config.MQ_TLS_KEY_REPOSITORY
        }),
        SecurityParms: expect.objectContaining({
          UserId: config.MQ_PRODUCER_USERNAME,
          Password: config.MQ_PRODUCER_PASSWORD
        })
      })
    );

    expect(mq.PutPromise).toHaveBeenCalledWith(
      "queue",
      expect.objectContaining({
        Persistence: 1,
        CodedCharSetId: 1208
      }),
      expect.objectContaining({
        Options: 15
      }),
      JSON.stringify(event)
    );

    expect(mq.Cmit).toHaveBeenCalledWith("connection");
    expect(mq.Back).not.toHaveBeenCalled();
  });

  it("utiliza las credenciales exclusivas del productor", async () => {
    const { mq, broker } = setup();

    await broker.publish(event);

    expect(mq.ConnxPromise).toHaveBeenCalledWith(
      "QM1",
      expect.objectContaining({
        SecurityParms: expect.objectContaining({
          UserId: "authproducer",
          Password: "test"
        })
      })
    );
  });

  it("hace rollback si falla el envío", async () => {
    const { mq, broker } = setup();

    mq.PutPromise.mockRejectedValue(new Error("fallo"));

    await expect(broker.publish(event)).rejects.toThrow(
      "no confirmó"
    );

    expect(mq.Cmit).not.toHaveBeenCalled();
    expect(mq.Back).toHaveBeenCalledWith("connection");
    expect(mq.DiscPromise).toHaveBeenCalled();
  });

  it("un commit fallido no cuenta como publicación confirmada", async () => {
    const { mq, broker } = setup();

    mq.Cmit.mockImplementation(() => {
      throw new Error("fallo");
    });

    await expect(broker.publish(event)).rejects.toThrow(
      "no confirmó"
    );

    expect(mq.Back).toHaveBeenCalledWith("connection");
  });

  it("no reenvía por un error de limpieza posterior al commit", async () => {
    const { mq, broker } = setup();

    mq.ClosePromise.mockRejectedValue(new Error("cierre"));

    await expect(broker.publish(event)).resolves.toBeUndefined();

    expect(mq.Cmit).toHaveBeenCalledWith("connection");
    expect(mq.PutPromise).toHaveBeenCalledTimes(1);
  });

  it("no conecta para enviar un evento expirado", async () => {
    const { mq, broker } = setup();

    await expect(
      broker.publish({
        ...event,
        expiresAt: "2000-01-01T00:00:00Z"
      })
    ).rejects.toThrow("expiró");

    expect(mq.ConnxPromise).not.toHaveBeenCalled();
    expect(mq.PutPromise).not.toHaveBeenCalled();
  });
});
