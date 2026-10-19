import type { ConfiguracionRespondedor } from "./configuracion";
import type { MensajeSolicitud, ReceptorSolicitudes } from "./respondedor";

export interface EstructuraMq {
  new (): Record<string, unknown>;
}

export interface ClienteMq {
  MQC: Record<string, number | string>;
  MQCNO: EstructuraMq;
  MQCD: EstructuraMq;
  MQSCO: EstructuraMq;
  MQCSP: EstructuraMq;
  MQOD: EstructuraMq;
  MQMD: EstructuraMq;
  MQGMO: EstructuraMq;
  MQPMO: EstructuraMq;

  ConnxPromise(gestor: string, cno: unknown): Promise<unknown>;
  OpenPromise(conexion: unknown, od: unknown, opciones: number): Promise<unknown>;
  GetSync(cola: unknown, md: unknown, gmo: unknown, buffer: Buffer): number | undefined;
  Get(
    cola: unknown,
    md: unknown,
    gmo: unknown,
    cb: (
      err: { mqrc?: number } | null,
      objeto: unknown,
      gmo: unknown,
      md: unknown,
      data: Buffer | null,
      gestor: unknown
    ) => void
  ): void;
  GetDone(cola: unknown, cb?: (err: { mqrc?: number } | null) => void): void;
  PutPromise(objeto: unknown, md: unknown, pmo: unknown, cuerpo: string | Buffer): Promise<void>;
  ClosePromise(objeto: unknown, opciones: number): Promise<void>;
  DiscPromise(conexion: unknown): Promise<void>;
  Cmit(conexion: unknown): void;
  Back(conexion: unknown): void;
}

const TAMANO_SOLICITUD = 256 * 1024;
const CCSID_UTF8 = 1208;

function mqrcDe(error: unknown): number | undefined {
  const valor = (error as { mqrc?: unknown } | null | undefined)?.mqrc;
  return typeof valor === "number" ? valor : undefined;
}

// Adaptador real sobre ibmmq@2.1.9. La conexión y ambas colas permanecen
// abiertas; GET y PUT comparten la misma unidad de trabajo.
export function crearReceptorResumen(
  mq: ClienteMq,
  config: ConfiguracionRespondedor
): ReceptorSolicitudes {
  let conexion: unknown | undefined;
  let colaSolicitud: unknown | undefined;
  let colaRespuesta: unknown | undefined;
  let mensajeActual: MensajeSolicitud | undefined;

  const opcionesPut =
    Number(mq.MQC.MQPMO_SYNCPOINT) | Number(mq.MQC.MQPMO_FAIL_IF_QUIESCING);
  const opcionesGet =
    Number(mq.MQC.MQGMO_SYNCPOINT) |
    Number(mq.MQC.MQGMO_WAIT) |
    Number(mq.MQC.MQGMO_CONVERT) |
    Number(mq.MQC.MQGMO_FAIL_IF_QUIESCING);
  const opcionesEntrada =
    Number(mq.MQC.MQOO_INPUT_AS_Q_DEF) | Number(mq.MQC.MQOO_FAIL_IF_QUIESCING);
  const opcionesSalida =
    Number(mq.MQC.MQOO_OUTPUT) | Number(mq.MQC.MQOO_FAIL_IF_QUIESCING);
  const formatoTexto =
    typeof mq.MQC.MQFMT_STRING === "string" ? mq.MQC.MQFMT_STRING : "MQSTR";

  async function asegurar(): Promise<void> {
    if (conexion) return;

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
    credenciales.UserId = config.MQ_USERNAME;
    credenciales.Password = config.MQ_PASSWORD;
    cno.SecurityParms = credenciales;

    const abierta = await mq.ConnxPromise(config.MQ_QUEUE_MANAGER, cno);

    try {
      const entrada = await mq.OpenPromise(
        abierta,
        Object.assign(new mq.MQOD(), {
          ObjectName: config.MQ_SUMMARY_REQUEST_QUEUE,
          ObjectType: Number(mq.MQC.MQOT_Q)
        }),
        opcionesEntrada
      );
      const salida = await mq.OpenPromise(
        abierta,
        Object.assign(new mq.MQOD(), {
          ObjectName: config.MQ_SUMMARY_REPLY_QUEUE,
          ObjectType: Number(mq.MQC.MQOT_Q)
        }),
        opcionesSalida
      );

      conexion = abierta;
      colaSolicitud = entrada;
      colaRespuesta = salida;
    } catch (error) {
      try {
        await mq.DiscPromise(abierta);
      } catch {
        // Conservar el error original.
      }
      throw error;
    }
  }

  async function olvidar(): Promise<void> {
    const previaConexion = conexion;
    const previaSolicitud = colaSolicitud;
    const previaRespuesta = colaRespuesta;

    conexion = undefined;
    colaSolicitud = undefined;
    colaRespuesta = undefined;
    mensajeActual = undefined;

    if (previaConexion) {
      // Si quedara una transacción abierta, MQBACK la resuelve al desconectar.
      try {
        mq.Back(previaConexion);
      } catch {
        // Sin transacción pendiente o conexión ya perdida.
      }
    }

    for (const cola of [previaSolicitud, previaRespuesta]) {
      if (!cola) continue;
      try {
        await mq.ClosePromise(cola, 0);
      } catch {
        // La desconexión libera los recursos.
      }
    }

    if (previaConexion) {
      try {
        await mq.DiscPromise(previaConexion);
      } catch {
        // No altera el resultado de la operación.
      }
    }
  }

  async function olvidarSilencioso(): Promise<void> {
    try {
      await olvidar();
    } catch {
      // Conservar el error original.
    }
  }

  return {
    async recibir() {
      await asegurar();

      const descriptor = new mq.MQMD();
      const opciones = new mq.MQGMO();
      opciones.Options = opcionesGet;
      opciones.WaitInterval = config.MQ_SUMMARY_WAIT_MS;

      const buffer = Buffer.alloc(TAMANO_SOLICITUD);

      let longitud: number;
      try {
        longitud = mq.GetSync(colaSolicitud, descriptor, opciones, buffer) ?? 0;
      } catch (error) {
        if (mqrcDe(error) === Number(mq.MQC.MQRC_NO_MSG_AVAILABLE)) {
          return null;
        }
        await olvidarSilencioso();
        throw error;
      }

      const msgId = descriptor.MsgId;
      const replyToQ = descriptor.ReplyToQ;
      const backoutCount = descriptor.BackoutCount;

      if (!Buffer.isBuffer(msgId) || typeof replyToQ !== "string") {
        await olvidarSilencioso();
        throw new Error("La solicitud recibida no expone MsgId o ReplyToQ válidos.");
      }

      mensajeActual = {
        cuerpo: buffer.subarray(0, longitud).toString("utf8"),
        msgId: Buffer.from(msgId),
        replyToQ,
        backoutCount: typeof backoutCount === "number" ? backoutCount : 0
      };

      return mensajeActual;
    },

    async responder(destino, correlId, cuerpo) {
      await asegurar();
      if (!colaRespuesta) throw new Error("La cola de respuesta no está abierta.");
      if (destino !== config.MQ_SUMMARY_REPLY_QUEUE) {
        throw new Error("Destino de respuesta no permitido.");
      }

      const descriptor = new mq.MQMD();
      descriptor.Persistence = Number(mq.MQC.MQPER_PERSISTENT);
      descriptor.Expiry = Math.max(1, Math.floor(config.MQ_SUMMARY_REPLY_TTL_MS / 100));
      descriptor.Format = formatoTexto;
      descriptor.CodedCharSetId = CCSID_UTF8;
      descriptor.CorrelId = Buffer.from(correlId);

      const pmo = new mq.MQPMO();
      pmo.Options = opcionesPut;

      await mq.PutPromise(colaRespuesta, descriptor, pmo, Buffer.from(cuerpo, "utf8"));
    },

    async confirmar() {
      if (!conexion) throw new Error("No hay conexión IBM MQ para confirmar.");
      mq.Cmit(conexion);
      mensajeActual = undefined;
    },

    async revertir() {
      if (!conexion) throw new Error("No hay conexión IBM MQ para revertir.");
      mq.Back(conexion);
      mensajeActual = undefined;
    },

    async cerrar() {
      await olvidar();
    }
  };
}
