
import { abrirConexionMq, type ClienteMq, type ConexionMq } from "./conexion";
import type { ConsumerConfig } from "./configuracion";
import type {
  DiagnosticoBoq,
  MensajeRecibido,
  MotivoBoq,
  ReceptorMensajes
} from "./consumidor";

export type { ClienteMq } from "./conexion";

// Tamaño base del buffer de recepción y tope duro para reintentos acotados.
// Nunca se trunca en silencio: si un mensaje excede el tope, la lectura falla
// y el mensaje no se confirma ni se descarta.
const TAMANO_MENSAJE_BASE = 64 * 1024;
const TAMANO_MENSAJE_ABSOLUTO = 1024 * 1024;

// Identificador y versión del sobre JSON de diagnóstico publicado en la BOQ.
const FORMATO_DIAGNOSTICO = "auth-cdn.mq.boq.diagnostico";
const VERSION_DIAGNOSTICO = 1;

// CCSID UTF-8 (IBM MQ no expone una constante para este valor).
const CCSID_UTF8 = 1208;

// Error de lectura en el que no pudo conservarse el mensaje íntegro. No debe
// derivar en confirmación ni descarte del mensaje original.
export class ErrorLecturaNoConservable extends Error {
  readonly mqrc: number | undefined;

  constructor(mqrc: number | undefined) {
    super(
      "No se pudo conservar íntegramente el mensaje recibido de IBM MQ " +
        "(error de tamaño o de conversión)."
    );
    this.name = "ErrorLecturaNoConservable";
    this.mqrc = mqrc;
  }
}

// El COMMIT del traslado devolvió un resultado incierto. El traslado pudo
// haberse confirmado; no se afirma un fallo definitivo ni se reintenta el PUT.
export class ErrorCommitIncierto extends Error {
  constructor() {
    super(
      "El COMMIT del traslado a la Backout Queue arrojó un resultado incierto."
    );
    this.name = "ErrorCommitIncierto";
  }
}

// Log estructurado sin secretos.
function registrar(datos: Record<string, unknown>): void {
  console.log(JSON.stringify({ proceso: "consumidor", ...datos }));
}

// El mensaje descriptor expone BackoutCount como número. Si el entorno no lo
// proporciona (por ejemplo, estructuras simuladas), se asume cero.
function extraerBackoutCount(descriptor: unknown): number {
  const valor = (descriptor as { BackoutCount?: unknown } | null | undefined)
    ?.BackoutCount;

  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

function mqrcDe(error: unknown): number | undefined {
  const valor = (error as { mqrc?: unknown } | null | undefined)?.mqrc;

  return typeof valor === "number" ? valor : undefined;
}

function aBase64(valor: unknown): string | null {
  return Buffer.isBuffer(valor) ? valor.toString("base64") : null;
}

// Capa de lectura: obtiene un mensaje bajo syncpoint y expone confirmación
// (commit), reversión (rollback) y traslado transaccional a la Backout Queue.
// La interpretación del mensaje corresponde al consumidor.
export function crearReceptorMq(
  mq: ClienteMq,
  config: ConsumerConfig
): ReceptorMensajes {
  let actual: ConexionMq | undefined;
  let colaBoq: unknown | undefined;
  let descriptorActual: Record<string, unknown> | undefined;
  let cuerpoActual: Buffer | undefined;
  let conversionAplicada = false;

  // MQC.MQFMT_STRING representa la cadena "MQSTR"; el tipo de MQC se declara
  // numérico para las constantes usadas en aritmética de opciones.
  const valorMqfmt = (mq.MQC as Record<string, unknown>).MQFMT_STRING;
  const formatoTexto = typeof valorMqfmt === "string" ? valorMqfmt : "MQSTR";

  const codigosConversion = [
    mq.MQC.MQRC_NOT_CONVERTED,
    mq.MQC.MQRC_PARTIALLY_CONVERTED,
    mq.MQC.MQRC_CONVERTED_MSG_TOO_BIG,
    mq.MQC.MQRC_CONVERTED_STRING_TOO_BIG,
    mq.MQC.MQRC_STRING_TRUNCATED,
    mq.MQC.MQRC_SOURCE_CCSID_ERROR,
    mq.MQC.MQRC_TARGET_CCSID_ERROR,
    mq.MQC.MQRC_ENCODING_ERROR
  ];

  const codigosTamano = [
    mq.MQC.MQRC_TRUNCATED_MSG_FAILED,
    mq.MQC.MQRC_TRUNCATED_MSG_ACCEPTED,
    mq.MQC.MQRC_DATA_LENGTH_ERROR
  ];

  function esMensajeAgotado(error: unknown): boolean {
    return mqrcDe(error) === mq.MQC.MQRC_NO_MSG_AVAILABLE;
  }

  function esReintentableLectura(error: unknown): boolean {
    const mqrc = mqrcDe(error);

    return (
      mqrc !== undefined &&
      (codigosConversion.includes(mqrc) || codigosTamano.includes(mqrc))
    );
  }

  async function olvidar(): Promise<void> {
    const previa = actual;

    actual = undefined;
    colaBoq = undefined;
    descriptorActual = undefined;
    cuerpoActual = undefined;
    conversionAplicada = false;

    if (previa) {
      await previa.cerrar();
    }
  }

  async function olvidarSilencioso(): Promise<void> {
    try {
      await olvidar();
    } catch {
      // Conservar el error original.
    }
  }

  async function asegurar(): Promise<ConexionMq> {
    if (!actual) {
      actual = await abrirConexionMq(mq, config);
    }

    return actual;
  }

  function leer(
    conexion: ConexionMq,
    convertir: boolean,
    buffer: Buffer
  ): { descriptor: Record<string, unknown>; longitud: number } {
    const descriptor = new mq.MQMD();
    const opciones = new mq.MQGMO();

    // El mensaje permanece bajo transacción hasta ejecutar commit.
    opciones.Options =
      mq.MQC.MQGMO_SYNCPOINT |
      mq.MQC.MQGMO_WAIT |
      mq.MQC.MQGMO_FAIL_IF_QUIESCING |
      (convertir ? mq.MQC.MQGMO_CONVERT : 0);

    opciones.WaitInterval = config.MQ_CONSUMER_WAIT_MS;

    const longitud = mq.GetSync(conexion.cola, descriptor, opciones, buffer);

    // GetSync devuelve la longitud recibida; nunca se asume el buffer completo.
    return {
      descriptor,
      longitud:
        typeof longitud === "number" && Number.isFinite(longitud) && longitud >= 0
          ? longitud
          : 0
    };
  }

  // Abre la Backout Queue sobre la misma conexión, una sola vez por conexión.
  async function asegurarBoq(conexion: ConexionMq): Promise<unknown> {
    if (colaBoq === undefined) {
      colaBoq = await conexion.abrirCola(
        config.MQ_BACKOUT_QUEUE,
        mq.MQC.MQOO_OUTPUT | mq.MQC.MQOO_FAIL_IF_QUIESCING
      );
    }

    return colaBoq;
  }

  // Sobre JSON de diagnóstico: conserva el cuerpo recuperable en Base64 y los
  // metadatos necesarios para interpretar su codificación y formato. No se
  // envuelve en campos de contexto MQMD que requieran autorización elevada.
  function construirSobre(
    mensaje: MensajeRecibido,
    diagnostico: DiagnosticoBoq
  ): Buffer {
    const cuerpo = cuerpoActual ?? Buffer.from(mensaje.cuerpo, "utf8");
    const descriptor = descriptorActual;

    const sobre: Record<string, unknown> = {
      formato: FORMATO_DIAGNOSTICO,
      version: VERSION_DIAGNOSTICO,
      motivo: diagnostico.motivo,
      backoutCount: mensaje.backoutCount,
      fechaDerivacion: new Date().toISOString(),
      colaOrigen: config.MQ_QUEUE,
      mensajeOriginal: {
        msgId: aBase64(descriptor?.MsgId),
        correlId: aBase64(descriptor?.CorrelId),
        format:
          typeof descriptor?.Format === "string" ? descriptor.Format : null,
        codedCharSetId:
          typeof descriptor?.CodedCharSetId === "number"
            ? descriptor.CodedCharSetId
            : null,
        encoding:
          typeof descriptor?.Encoding === "number" ? descriptor.Encoding : null,
        // El cuerpo se recibió tras MQGMO_CONVERT; no se afirma que sean los
        // bytes originales anteriores a la conversión.
        conversionAplicada
      },
      cuerpoBase64: cuerpo.toString("base64"),
      cuerpoBytes: cuerpo.length
    };

    if (diagnostico.eventId) {
      sobre.eventId = diagnostico.eventId;
    }

    return Buffer.from(JSON.stringify(sobre), "utf8");
  }

  async function trasladarABoq(
    mensaje: MensajeRecibido,
    diagnostico: DiagnosticoBoq
  ): Promise<void> {
    const conexion = await asegurar();

    try {
      const destino = await asegurarBoq(conexion);

      const descriptor = new mq.MQMD();

      // Correlación con el mensaje original (no requiere contexto elevado).
      const correlId = descriptorActual?.CorrelId;
      const msgId = descriptorActual?.MsgId;
      if (Buffer.isBuffer(correlId) && correlId.length > 0) {
        descriptor.CorrelId = Buffer.from(correlId);
      } else if (Buffer.isBuffer(msgId)) {
        descriptor.CorrelId = Buffer.from(msgId);
      }

      // Persistencia y expiración explícitas para no perder el diagnóstico.
      descriptor.Persistence = mq.MQC.MQPER_PERSISTENT;
      descriptor.Expiry = mq.MQC.MQEI_UNLIMITED;

      // El sobre es texto UTF-8: formato y CCSID coherentes con el contenido.
      descriptor.Format = formatoTexto;
      descriptor.CodedCharSetId = CCSID_UTF8;

      const opcionesPut = new mq.MQPMO();
      opcionesPut.Options =
        mq.MQC.MQPMO_SYNCPOINT | mq.MQC.MQPMO_FAIL_IF_QUIESCING;

      const cuerpo = construirSobre(mensaje, diagnostico);

      // Una única unidad de trabajo: el GET original sigue pendiente, el PUT
      // bajo syncpoint no se confirma hasta el COMMIT inmediatamente posterior.
      await mq.PutPromise(destino, descriptor, opcionesPut, cuerpo);
    } catch (error) {
      // El PUT falló antes del COMMIT: el rollback devuelve el original.
      try {
        mq.Back(conexion.conexion);
      } catch {
        // Conservar el error original de publicación.
      }

      registrar({
        evento: "boq_error",
        motivo: diagnostico.motivo,
        cola: config.MQ_BACKOUT_QUEUE,
        backoutCount: mensaje.backoutCount,
        eventId: diagnostico.eventId
      });

      throw error;
    }

    // El PUT ya está pendiente; solo el COMMIT decide el desenlace.
    try {
      mq.Cmit(conexion.conexion);
    } catch {
      // Resultado incierto: no se afirma fallo definitivo ni se reintenta el PUT.
      registrar({
        evento: "boq_commit_incierto",
        motivo: diagnostico.motivo,
        cola: config.MQ_BACKOUT_QUEUE,
        backoutCount: mensaje.backoutCount,
        eventId: diagnostico.eventId
      });

      // Descartar la conexión deja que MQ resuelva la transacción pendiente.
      await olvidarSilencioso();

      throw new ErrorCommitIncierto();
    }

    registrar({
      evento: "boq",
      motivo: diagnostico.motivo,
      cola: config.MQ_BACKOUT_QUEUE,
      backoutCount: mensaje.backoutCount,
      eventId: diagnostico.eventId
    });
  }

  return {
    async recibir(): Promise<MensajeRecibido | null> {
      const conexion = await asegurar();

      // Plan acotado: primero con conversión; si falla por tamaño o conversión,
      // se reintenta sin conversión (bytes crudos) y, como último recurso, con
      // un buffer mayor. Nunca se trunca en silencio.
      const plan = [
        { convertir: true, tamano: TAMANO_MENSAJE_BASE },
        { convertir: false, tamano: TAMANO_MENSAJE_BASE },
        { convertir: false, tamano: TAMANO_MENSAJE_ABSOLUTO }
      ];

      let ultimoError: unknown;

      for (const paso of plan) {
        const buffer = Buffer.alloc(paso.tamano);

        try {
          const { descriptor, longitud } = leer(
            conexion,
            paso.convertir,
            buffer
          );

          // Conservar descriptor y bytes recibidos para el posible traslado.
          descriptorActual = descriptor;
          cuerpoActual = buffer.subarray(0, longitud);
          conversionAplicada = paso.convertir;

          // Convertir únicamente los bytes recibidos.
          return {
            cuerpo: cuerpoActual.toString("utf8"),
            backoutCount: extraerBackoutCount(descriptor)
          };
        } catch (error) {
          // Una cola sin mensajes es una condición normal.
          if (esMensajeAgotado(error)) {
            return null;
          }

          ultimoError = error;

          // Los errores ajenos a tamaño/conversión no se reintentan.
          if (!esReintentableLectura(error)) {
            await olvidarSilencioso();
            throw error;
          }
        }
      }

      // Se agotó el plan acotado sin conservar el mensaje: fallar sin confirmar
      // ni descartar. El bucle externo aplica su espera entre intentos.
      await olvidarSilencioso();
      throw new ErrorLecturaNoConservable(mqrcDe(ultimoError));
    },

    async confirmar(): Promise<void> {
      if (!actual) {
        throw new Error(
          "No hay conexión IBM MQ para confirmar el mensaje."
        );
      }

      // MQCMIT confirma la lectura realizada bajo syncpoint.
      mq.Cmit(actual.conexion);
    },

    async revertir(): Promise<void> {
      if (!actual) {
        throw new Error(
          "No hay conexión IBM MQ para revertir el mensaje."
        );
      }

      // MQBACK devuelve el mensaje a la cola para su reintento.
      mq.Back(actual.conexion);
    },

    async moverABoq(
      mensaje: MensajeRecibido,
      diagnostico: DiagnosticoBoq
    ): Promise<void> {
      await trasladarABoq(mensaje, diagnostico);
    },

    async cerrar(): Promise<void> {
      await olvidar();
    }
  };
}
