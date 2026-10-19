
import type * as IBM from "ibmmq";
import type { ReminderEvent } from "../../lib/mq/contrato";
import type { ProducerConfig } from "./configuracion";

import { expiryTenths } from "./configuracion";

export function createMqBroker(mq: typeof IBM, config: ProducerConfig) {
  return {
    async publish(event: ReminderEvent) {
      // Validar antes de abrir una conexión y recalcular tras conectarse.
      expiryTenths(event.expiresAt);

      const cno = new mq.MQCNO();
      cno.Options =
        mq.MQC.MQCNO_CLIENT_BINDING |
        mq.MQC.MQCNO_RECONNECT_DISABLED;

      const channel = new mq.MQCD();
      channel.ChannelName = config.MQ_CHANNEL;
      channel.ConnectionName = config.MQ_CONNECTION_NAME;
      channel.SSLCipherSpec = config.MQ_TLS_CIPHER_SPEC;
      channel.SSLPeerName = config.MQ_TLS_PEER_NAME;
      cno.ClientConn = channel;

      // Configuración TLS.
      const tls = new mq.MQSCO();
      tls.KeyRepository = config.MQ_TLS_KEY_REPOSITORY;

      if (config.MQ_TLS_KEY_REPOSITORY_PASSWORD) {
        tls.KeyRepoPassword = config.MQ_TLS_KEY_REPOSITORY_PASSWORD;
      }

      if (config.MQ_TLS_CERTIFICATE_LABEL) {
        tls.CertificateLabel = config.MQ_TLS_CERTIFICATE_LABEL;
      }

      cno.SSLConfig = tls;

      // Credenciales exclusivas del productor.
      const credentials = new mq.MQCSP();
      credentials.UserId = config.MQ_PRODUCER_USERNAME;
      credentials.Password = config.MQ_PRODUCER_PASSWORD;
      cno.SecurityParms = credentials;

      const connection = await mq.ConnxPromise(
        config.MQ_QUEUE_MANAGER,
        cno
      );

      let queue: IBM.MQObject | undefined;
      let committed = false;

      try {
        const destination = new mq.MQOD();
        destination.ObjectName = config.MQ_QUEUE;
        destination.ObjectType = mq.MQC.MQOT_Q;

        queue = await mq.OpenPromise(
          connection,
          destination,
          mq.MQC.MQOO_OUTPUT |
            mq.MQC.MQOO_FAIL_IF_QUIESCING
        );

        const descriptor = new mq.MQMD();
        descriptor.Persistence = mq.MQC.MQPER_PERSISTENT;
        descriptor.Expiry = expiryTenths(event.expiresAt);
        descriptor.Format = mq.MQC.MQFMT_STRING;
        descriptor.CodedCharSetId = 1208;

        const options = new mq.MQPMO();
        options.Options =
          mq.MQC.MQPMO_SYNCPOINT |
          mq.MQC.MQPMO_SYNC_RESPONSE |
          mq.MQC.MQPMO_NEW_MSG_ID |
          mq.MQC.MQPMO_FAIL_IF_QUIESCING;

        await mq.PutPromise(
          queue,
          descriptor,
          options,
          JSON.stringify(event)
        );

        mq.Cmit(connection);
        committed = true;
      } catch {
        if (!committed) {
          try {
            mq.Back(connection);
          } catch {
            // Resultado incierto: se reintentará con el mismo eventId.
          }
        }

        throw new Error("IBM MQ no confirmó la publicación.");
      } finally {
        // Un fallo de limpieza no debe convertir un commit confirmado
        // en un reintento.
        if (queue) {
          try {
            await mq.ClosePromise(queue, 0);
          } catch {
            // La desconexión libera los recursos.
          }
        }

        try {
          await mq.DiscPromise(connection);
        } catch {
          // No altera el resultado del commit.
        }
      }
    }
  };
}
