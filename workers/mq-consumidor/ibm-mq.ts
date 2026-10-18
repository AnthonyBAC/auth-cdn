import { abrirConexionMq, type ClienteMq, type ConexionMq } from "./conexion";
import type { ConsumerConfig } from "./configuracion";
import type { MensajeRecibido, ReceptorMensajes } from "./consumidor";

export type { ClienteMq } from "./conexion";

// Capa de lectura: obtiene el mensaje bajo syncpoint y expone confirmación (commit)
// y reversión (rollback). No interpreta el cuerpo: eso es responsabilidad del consumidor.
export function crearReceptorMq(mq: ClienteMq, config: ConsumerConfig): ReceptorMensajes {
  let actual: ConexionMq | undefined;

  async function olvidar(): Promise<void> {
    const previa = actual;
    actual = undefined;
    if (previa) await previa.cerrar();
  }

  async function asegurar(): Promise<ConexionMq> {
    if (!actual) actual = await abrirConexionMq(mq, config);
    return actual;
  }

  function esMensajeAgotado(error: unknown): boolean {
    return (error as { mqrc?: number } | null | undefined)?.mqrc === mq.MQC.MQRC_NO_MSG_AVAILABLE;
  }

  return {
    async recibir(): Promise<MensajeRecibido | null> {
      const conexion = await asegurar();
      const descriptor = new mq.MQMD();
      const opciones = new mq.MQGMO();
      // Bajo syncpoint: el mensaje no se elimina de la cola hasta confirmar.
      opciones.Options = mq.MQC.MQGMO_SYNCPOINT | mq.MQC.MQGMO_WAIT |
        mq.MQC.MQGMO_CONVERT | mq.MQC.MQGMO_FAIL_IF_QUIESCING;
      opciones.WaitInterval = config.MQ_CONSUMER_WAIT_MS;
      try {
        const cuerpo = await mq.GetPromise(conexion.cola, descriptor, opciones);
        return { cuerpo: cuerpo.toString("utf8") };
      } catch (error) {
        if (esMensajeAgotado(error)) return null;
        // Un fallo de lectura puede dejar la conexión inservible: se reconstruye en la próxima lectura.
        await olvidar();
        throw error;
      }
    },
    async confirmar(): Promise<void> {
      if (!actual) throw new Error("No hay conexión IBM MQ para confirmar el mensaje.");
      mq.Cmit(actual.conexion);
    },
    async revertir(): Promise<void> {
      if (!actual) throw new Error("No hay conexión IBM MQ para revertir el mensaje.");
      mq.Back(actual.conexion);
    },
    async cerrar(): Promise<void> {
      await olvidar();
    }
  };
}
