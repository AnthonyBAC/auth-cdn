import type { ReminderEvent } from "../../lib/mq/contrato";
import { validarMensaje } from "./validar-mensaje";

export interface MensajeRecibido {
  cuerpo: string;
}

// Contrato mínimo que separa la recepción MQ del procesamiento de negocio.
export interface ReceptorMensajes {
  recibir(): Promise<MensajeRecibido | null>;
  confirmar(): Promise<void>;
  revertir(): Promise<void>;
  cerrar(): Promise<void>;
}

// Resultado explícito del procesamiento. Los nombres coinciden con los desenlaces
// persistidos por la función SQL `process_reminder_event`; solo RETRYABLE_ERROR
// representa un fallo temporal que exige reintento.
export type ResultadoProcesamiento =
  | "PROCESSED"
  | "ALREADY_PROCESSED"
  | "CANCELLED"
  | "EXPIRED"
  | "RETRYABLE_ERROR"
  | "PERMANENT_ERROR";

export interface ProcesadorAviso {
  procesar(event: ReminderEvent): Promise<ResultadoProcesamiento>;
}

export type ResultadoCiclo = "EMPTY" | "DISCARDED" | ResultadoProcesamiento;

// Un ciclo: leer, validar el contrato y solo entonces confirmar o revertir.
// Nunca se confirma el mensaje antes de que el procesador termine: si el
// procesamiento requiere persistencia, esta ocurre dentro de `procesar()`.
export async function procesarSiguiente(
  receptor: ReceptorMensajes,
  procesador: ProcesadorAviso,
  now: Date = new Date(),
): Promise<ResultadoCiclo> {
  const mensaje = await receptor.recibir();
  if (mensaje === null) return "EMPTY";

  const validacion = validarMensaje(mensaje.cuerpo, now);
  if (!validacion.ok) {
    // Fallo permanente del contrato (JSON/contrato inválido o expirado): se descarta
    // sin reintentos infinitos. Pendiente: derivar a la DLQ cuando exista.
    await receptor.confirmar();
    return "DISCARDED";
  }

  let resultado: ResultadoProcesamiento;
  try {
    resultado = await procesador.procesar(validacion.event);
  } catch {
    // Error recuperable: no se confirma, el mensaje vuelve a la cola.
    await receptor.revertir();
    return "RETRYABLE_ERROR";
  }

  if (resultado === "RETRYABLE_ERROR") {
    await receptor.revertir();
    return resultado;
  }

  // Desenlaces terminales. En PROCESSED el resultado ya quedó persistido por el
  // procesador (RPC atómica) antes de confirmar el mensaje. PERMANENT_ERROR se
  // descarta de forma explícita; pendiente de integrarse con la DLQ.
  await receptor.confirmar();
  return resultado;
}
