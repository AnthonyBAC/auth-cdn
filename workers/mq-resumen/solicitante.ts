import { randomUUID } from "node:crypto";

import {
  RESUMEN_SCHEMA_VERSION,
  expiracionEnDecimas,
  resumenReplySchema,
  type ResumenReply,
  type ResumenRequest
} from "../../lib/mq/resumen";
import type { ClienteMq } from "./ibm-mq";

export type ConfiguracionSolicitud = {
  MQ_QUEUE_MANAGER: string;
  MQ_CHANNEL: string;
  MQ_CONNECTION_NAME: string;
  MQ_TLS_CIPHER_SPEC: string;
  MQ_TLS_PEER_NAME: string;
  MQ_TLS_KEY_REPOSITORY: string;
  MQ_TLS_KEY_REPOSITORY_PASSWORD?: string;
  MQ_TLS_CERTIFICATE_LABEL?: string;
  MQ_SUMMARY_REQUEST_QUEUE: string;
  MQ_SUMMARY_REPLY_QUEUE: string;
  MQ_PRODUCER_USERNAME: string;
  MQ_PRODUCER_PASSWORD: string;
  MQ_SUMMARY_TIMEOUT_MS: number;
  MQ_SUMMARY_REQUEST_TTL_MS: number;
};

export class ErrorTimeoutResumen extends Error {
  constructor() {
    super("IBM MQ no devolvió el resumen dentro del tiempo configurado.");
    this.name = "ErrorTimeoutResumen";
  }
}

export class ErrorMqResumen extends Error {
  constructor(message = "IBM MQ no pudo completar el intercambio de mensajes.") {
    super(message);
    this.name = "ErrorMqResumen";
  }
}

export class ErrorRespuestaResumen extends Error {
  constructor(message = "La respuesta de IBM MQ no cumple el contrato.") {
    super(message);
    this.name = "ErrorRespuestaResumen";
  }
}

export type SolicitanteResumen = {
  solicitar(input: { boardId: string; userId: string; now?: Date }): Promise<ResumenReply>;
};

const CCSID_UTF8 = 1208;

function mqrcDe(error: unknown): number | undefined {
  const valor = (error as { mqrc?: unknown } | null | undefined)?.mqrc;
  return typeof valor === "number" ? valor : undefined;
}

// Cada solicitud abre su propia conexión y su propio handle de la cola de
// respuesta. Aunque dos usuarios soliciten a la vez, MQMO_MATCH_CORREL_ID
// garantiza que cada uno solo reciba la respuesta con el MsgId de su solicitud.
export function crearSolicitanteMq(
  mq: ClienteMq,
  config: ConfiguracionSolicitud
): SolicitanteResumen {
  return {
    async solicitar({ boardId, userId, now = new Date() }) {
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + config.MQ_SUMMARY_REQUEST_TTL_MS).toISOString();
      const request: ResumenRequest = {
        schemaVersion: RESUMEN_SCHEMA_VERSION,
        requestId: randomUUID(),
        boardId,
        userId,
        createdAt,
        expiresAt
      };

      // Validar TTL antes de abrir la conexión.
      expiracionEnDecimas(request.expiresAt, now.getTime());

      const cno = new mq.MQCNO();
      cno.Options =
        Number(mq.MQC.MQCNO_CLIENT_BINDING) | Number(mq.MQC.MQCNO_RECONNECT_DISABLED);

      const canal = new mq.MQCD();
      canal.ChannelName = config.MQ_CHANNEL;
      canal.ConnectionName = config.MQ_CONNECTION_NAME;
      canal.SSLCipherSpec = config.MQ_TLS_CIPHER_SPEC;
      canal.SSLPeerName = config.MQ_TLS_PEER_NAME;
      cno.ClientConn = canal;

      const tls = new mq.MQSCO();
      tls.KeyRepository = config.MQ_TLS_KEY_REPOSITORY;
      if (config.MQ_TLS_KEY_REPOSITORY_PASSWORD) {
        tls.KeyRepoPassword = config.MQ_TLS_KEY_REPOSITORY_PASSWORD;
      }
      if (config.MQ_TLS_CERTIFICATE_LABEL) {
        tls.CertificateLabel = config.MQ_TLS_CERTIFICATE_LABEL;
      }
      cno.SSLConfig = tls;

      const credenciales = new mq.MQCSP();
      credenciales.UserId = config.MQ_PRODUCER_USERNAME;
      credenciales.Password = config.MQ_PRODUCER_PASSWORD;
      cno.SecurityParms = credenciales;

      let conexion: unknown;
      try {
        conexion = await mq.ConnxPromise(config.MQ_QUEUE_MANAGER, cno);
      } catch {
        throw new ErrorMqResumen("No se pudo conectar a IBM MQ.");
      }

      let colaSolicitud: unknown | undefined;
      let colaRespuesta: unknown | undefined;

      async function cerrar(): Promise<void> {
        for (const cola of [colaSolicitud, colaRespuesta]) {
          if (!cola) continue;
          try {
            await mq.ClosePromise(cola, 0);
          } catch {
            // La desconexión libera los recursos.
          }
        }
        try {
          await mq.DiscPromise(conexion);
        } catch {
          // No altera el resultado.
        }
      }

      try {
        colaSolicitud = await mq.OpenPromise(
          conexion,
          Object.assign(new mq.MQOD(), {
            ObjectName: config.MQ_SUMMARY_REQUEST_QUEUE,
            ObjectType: Number(mq.MQC.MQOT_Q)
          }),
          Number(mq.MQC.MQOO_OUTPUT) | Number(mq.MQC.MQOO_FAIL_IF_QUIESCING)
        );

        colaRespuesta = await mq.OpenPromise(
          conexion,
          Object.assign(new mq.MQOD(), {
            ObjectName: config.MQ_SUMMARY_REPLY_QUEUE,
            ObjectType: Number(mq.MQC.MQOT_Q)
          }),
          Number(mq.MQC.MQOO_INPUT_AS_Q_DEF) | Number(mq.MQC.MQOO_FAIL_IF_QUIESCING)
        );

        const descriptor = new mq.MQMD();
        descriptor.Persistence = Number(mq.MQC.MQPER_PERSISTENT);
        descriptor.Expiry = expiracionEnDecimas(request.expiresAt, now.getTime());
        descriptor.Format =
          typeof mq.MQC.MQFMT_STRING === "string" ? mq.MQC.MQFMT_STRING : "MQSTR";
        descriptor.CodedCharSetId = CCSID_UTF8;
        descriptor.ReplyToQ = config.MQ_SUMMARY_REPLY_QUEUE;

        const pmo = new mq.MQPMO();
        pmo.Options =
          Number(mq.MQC.MQPMO_SYNCPOINT) |
          Number(mq.MQC.MQPMO_SYNC_RESPONSE) |
          Number(mq.MQC.MQPMO_NEW_MSG_ID) |
          Number(mq.MQC.MQPMO_FAIL_IF_QUIESCING);

        try {
          await mq.PutPromise(
            colaSolicitud,
            descriptor,
            pmo,
            Buffer.from(JSON.stringify(request), "utf8")
          );
          mq.Cmit(conexion);
        } catch {
          try {
            mq.Back(conexion);
          } catch {
            // Resultado incierto; el llamador no debe asumir publicación.
          }
          throw new ErrorMqResumen("IBM MQ no confirmó la publicación de la solicitud.");
        }

        const requestMsgId = descriptor.MsgId;
        if (!Buffer.isBuffer(requestMsgId) || requestMsgId.length === 0) {
          throw new ErrorMqResumen("IBM MQ no devolvió el MsgId de la solicitud.");
        }

        // Get() entrega mensajes por callback sin bloquear el hilo del puente.
        // Cada solicitud tiene su propia conexión y su propio handle de Reply,
        // y MQMO_MATCH_CORREL_ID limita la entrega al MsgId de esta solicitud.
        const reply = await new Promise<ResumenReply>((resolve, reject) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | undefined;

          function detener(): Promise<void> {
            return new Promise((done) => {
              let finished = false;
              const finish = () => {
                if (finished) return;
                finished = true;
                done();
              };

              try {
                mq.GetDone(colaRespuesta, finish);
              } catch {
                finish();
              }
              // No dejar la petición HTTP colgada si MQ no invoca el callback.
              setTimeout(finish, 250);
            });
          }

          function terminar(result: { ok: true; value: ResumenReply } | { ok: false; error: Error }): void {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            void detener().then(() => {
              if (result.ok) resolve(result.value);
              else reject(result.error);
            });
          }

          function descartar(error: Error): void {
            try {
              mq.Cmit(conexion);
            } catch {
              terminar({ ok: false, error: new ErrorMqResumen() });
              return;
            }
            terminar({ ok: false, error });
          }

          const replyDescriptor = new mq.MQMD();
          replyDescriptor.CorrelId = Buffer.from(requestMsgId);

          const gmo = new mq.MQGMO();
          gmo.Options =
            Number(mq.MQC.MQGMO_SYNCPOINT) |
            Number(mq.MQC.MQGMO_WAIT) |
            Number(mq.MQC.MQGMO_CONVERT) |
            Number(mq.MQC.MQGMO_FAIL_IF_QUIESCING);
          gmo.MatchOptions = Number(mq.MQC.MQMO_MATCH_CORREL_ID);
          gmo.WaitInterval = config.MQ_SUMMARY_TIMEOUT_MS;

          timer = setTimeout(
            () => terminar({ ok: false, error: new ErrorTimeoutResumen() }),
            config.MQ_SUMMARY_TIMEOUT_MS + 250
          );

          try {
            mq.Get(colaRespuesta, replyDescriptor, gmo, (error, _objeto, _opciones, _descriptor, data) => {
              if (settled) return;

              if (error) {
                if (mqrcDe(error) === Number(mq.MQC.MQRC_NO_MSG_AVAILABLE)) {
                  terminar({ ok: false, error: new ErrorTimeoutResumen() });
                } else {
                  terminar({ ok: false, error: new ErrorMqResumen("IBM MQ no pudo leer la respuesta.") });
                }
                return;
              }

              const bytes = data ?? Buffer.alloc(0);

              let payload: unknown;
              try {
                payload = JSON.parse(bytes.toString("utf8"));
              } catch {
                descartar(new ErrorRespuestaResumen("La respuesta no contiene JSON válido."));
                return;
              }

              const parsed = resumenReplySchema.safeParse(payload);
              if (!parsed.success) {
                descartar(new ErrorRespuestaResumen("La respuesta no cumple el contrato."));
                return;
              }

              if (
                parsed.data.requestId !== request.requestId ||
                parsed.data.boardId !== request.boardId
              ) {
                // Correlación MQ correcta pero contenido ajeno: descartar y seguir.
                try {
                  mq.Cmit(conexion);
                } catch {
                  terminar({ ok: false, error: new ErrorMqResumen() });
                }
                return;
              }

              try {
                mq.Cmit(conexion);
              } catch {
                terminar({ ok: false, error: new ErrorMqResumen() });
                return;
              }

              terminar({ ok: true, value: parsed.data });
            });
          } catch {
            terminar({ ok: false, error: new ErrorMqResumen() });
          }
        });

        return reply;
      } finally {
        await cerrar();
      }
    }
  };
}
