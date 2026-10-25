import type { ConsumerConfig } from "./configuracion";

// Subconjunto estructural del cliente nativo `ibmmq` que usamos. Declararlo aquí
// evita depender de los tipos del paquete nativo (que puede no estar instalado).
export interface EstructuraMq {
  new (): Record<string, unknown>;
}

export interface ClienteMq {
  MQC: Record<string, number>;
  MQCNO: EstructuraMq;
  MQCD: EstructuraMq;
  MQSCO: EstructuraMq;
  MQCSP: EstructuraMq;
  MQOD: EstructuraMq;
  MQMD: EstructuraMq;
  MQGMO: EstructuraMq;
  ConnxPromise(gestor: string, cno: unknown): Promise<unknown>;
  OpenPromise(conexion: unknown, od: unknown, opciones: number): Promise<unknown>;
  GetPromise(cola: unknown, md: unknown, gmo: unknown): Promise<Buffer>;
  ClosePromise(objeto: unknown, opciones: number): Promise<void>;
  DiscPromise(conexion: unknown): Promise<void>;
  Cmit(conexion: unknown): void;
  Back(conexion: unknown): void;
}

export interface ConexionMq {
  conexion: unknown;
  cola: unknown;
  cerrar(): Promise<void>;
}

// Abre la conexión TLS al gestor y la cola de entrada. No lee ni confirma mensajes:
// eso corresponde a la capa de recepción.
export async function abrirConexionMq(mq: ClienteMq, config: ConsumerConfig): Promise<ConexionMq> {
  const cno = new mq.MQCNO();
  cno.Options = mq.MQC.MQCNO_CLIENT_BINDING | mq.MQC.MQCNO_RECONNECT_DISABLED;
  const canal = new mq.MQCD();
  canal.ChannelName = config.MQ_CHANNEL;
  canal.ConnectionName = config.MQ_CONNECTION_NAME;
  canal.SSLCipherSpec = config.MQ_TLS_CIPHER_SPEC;
  canal.SSLPeerName = config.MQ_TLS_PEER_NAME;
  cno.ClientConn = canal;
  const tls = new mq.MQSCO();
  tls.KeyRepository = config.MQ_TLS_KEY_REPOSITORY;
  if (config.MQ_TLS_KEY_REPOSITORY_PASSWORD) tls.KeyRepoPassword = config.MQ_TLS_KEY_REPOSITORY_PASSWORD;
  if (config.MQ_TLS_CERTIFICATE_LABEL) tls.CertificateLabel = config.MQ_TLS_CERTIFICATE_LABEL;
  cno.SSLConfig = tls;
  const credenciales = new mq.MQCSP();
  credenciales.UserId = config.MQ_USERNAME;
  credenciales.Password = config.MQ_PASSWORD;
  cno.SecurityParms = credenciales;

  const conexion = await mq.ConnxPromise(config.MQ_QUEUE_MANAGER, cno);
  let cola: unknown;
  try {
    const destino = new mq.MQOD();
    destino.ObjectName = config.MQ_QUEUE;
    destino.ObjectType = mq.MQC.MQOT_Q;
    cola = await mq.OpenPromise(
      conexion,
      destino,
      mq.MQC.MQOO_INPUT_AS_Q_DEF | mq.MQC.MQOO_FAIL_IF_QUIESCING,
    );
  } catch (error) {
    // La conexión no debe quedar abierta si la cola no se pudo abrir.
    try { await mq.DiscPromise(conexion); } catch { /* La desconexión previa pudo fallar; no oculta el error original. */ }
    throw error;
  }

  let cerrada = false;
  return {
    conexion,
    cola,
    async cerrar() {
      if (cerrada) return;
      cerrada = true;
      // Un fallo de limpieza no debe propagarse: no hay resultado de negocio que revertir.
      try { await mq.ClosePromise(cola, 0); } catch { /* La desconexión libera los recursos. */ }
      try { await mq.DiscPromise(conexion); } catch { /* El gestor termina de liberar la conexión. */ }
    }
  };
}
