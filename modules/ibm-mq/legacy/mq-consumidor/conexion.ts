
import type { ConsumerConfig } from "./configuracion";

// Subconjunto estructural del cliente nativo `ibmmq` que utilizamos.
// Evita depender directamente de sus tipos cuando el paquete no está instalado.
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
  MQPMO: EstructuraMq;

  // Conexión y apertura de objetos IBM MQ.
  ConnxPromise(
    gestor: string,
    cno: unknown
  ): Promise<unknown>;

  OpenPromise(
    conexion: unknown,
    od: unknown,
    opciones: number
  ): Promise<unknown>;

  // Recepción síncrona de mensajes.
  // Devuelve la cantidad de bytes recibidos en el buffer.
  GetSync(
    cola: unknown,
    md: unknown,
    gmo: unknown,
    buffer: Buffer
  ): number;

  // Publicación asíncrona de un mensaje (cola o tema).
  PutPromise(
    objeto: unknown,
    md: unknown,
    pmo: unknown,
    cuerpo: string | Buffer
  ): Promise<void>;

  // Cierre de recursos.
  ClosePromise(
    objeto: unknown,
    opciones: number
  ): Promise<void>;

  DiscPromise(
    conexion: unknown
  ): Promise<void>;

  // Operaciones transaccionales.
  Cmit(conexion: unknown): void;
  Back(conexion: unknown): void;
}

export interface ConexionMq {
  conexion: unknown;
  cola: unknown;

  // Abre una cola adicional sobre la misma conexión y transacción.
  abrirCola(nombre: string, opciones: number): Promise<unknown>;

  cerrar(): Promise<void>;
}

// Abre una conexión TLS al Queue Manager y a la cola de entrada.
// No consume ni confirma mensajes: eso corresponde a la capa de recepción.
export async function abrirConexionMq(
  mq: ClienteMq,
  config: ConsumerConfig
): Promise<ConexionMq> {
  // Configuración de conexión.
  const cno = new mq.MQCNO();

  cno.Options =
    mq.MQC.MQCNO_CLIENT_BINDING |
    mq.MQC.MQCNO_RECONNECT_DISABLED;

  // Configuración del canal IBM MQ.
  const canal = new mq.MQCD();

  canal.ChannelName = config.MQ_CHANNEL;
  canal.ConnectionName = config.MQ_CONNECTION_NAME;
  canal.SSLCipherSpec = config.MQ_TLS_CIPHER_SPEC;
  canal.SSLPeerName = config.MQ_TLS_PEER_NAME;

  cno.ClientConn = canal;

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

  // Autenticación mediante usuario y API key de IBM MQ Cloud.
  const credenciales = new mq.MQCSP();

  credenciales.UserId = config.MQ_USERNAME;
  credenciales.Password = config.MQ_PASSWORD;

  cno.SecurityParms = credenciales;

  // Establecer conexión con el Queue Manager.
  const conexion = await mq.ConnxPromise(
    config.MQ_QUEUE_MANAGER,
    cno
  );

  const colasAbiertas: unknown[] = [];

  // Abre cualquier cola sobre la conexión ya establecida. Todas las colas
  // comparten la misma unidad de trabajo, de modo que un único COMMIT puede
  // retirar el original y publicar en la Backout Queue de forma atómica.
  async function abrirCola(nombre: string, opciones: number): Promise<unknown> {
    const destino = new mq.MQOD();

    destino.ObjectName = nombre;
    destino.ObjectType = mq.MQC.MQOT_Q;

    const abierta = await mq.OpenPromise(conexion, destino, opciones);
    colasAbiertas.push(abierta);

    return abierta;
  }

  let cola: unknown;

  try {
    // Abrir la cola principal con permisos de lectura.
    cola = await abrirCola(
      config.MQ_QUEUE,
      mq.MQC.MQOO_INPUT_AS_Q_DEF |
        mq.MQC.MQOO_FAIL_IF_QUIESCING
    );
  } catch (error) {
    // Evitar conexiones abiertas cuando falla MQOPEN.
    try {
      await mq.DiscPromise(conexion);
    } catch {
      // Conservar el error original de apertura.
    }

    throw error;
  }

  let cerrada = false;

  return {
    conexion,
    cola,
    abrirCola,

    async cerrar(): Promise<void> {
      if (cerrada) return;

      cerrada = true;

      // Cerrar cada cola abierta.
      for (const abierta of colasAbiertas) {
        try {
          await mq.ClosePromise(abierta, 0);
        } catch {
          // La desconexión intentará liberar los recursos restantes.
        }
      }

      // Desconectar del Queue Manager.
      try {
        await mq.DiscPromise(conexion);
      } catch {
        // Evitar que un error de limpieza oculte otro error.
      }
    }
  };
}
