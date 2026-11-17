import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReminderEvent } from "../../domain/contrato";
import type { ProcesadorAviso, ResultadoProcesamiento } from "./consumidor";

// Desenlaces que la RPC puede persistir. RETRYABLE_ERROR nunca lo devuelve la RPC:
// los fallos temporales de Supabase se propagan como excepción.
const desenlaces: ReadonlySet<ResultadoProcesamiento> = new Set([
  "PROCESSED",
  "ALREADY_PROCESSED",
  "CANCELLED",
  "EXPIRED",
  "PERMANENT_ERROR",
]);

interface RespuestaProcesamiento {
  outcome?: unknown;
}

// Procesador real: delega toda la lógica atómica e idempotente en la RPC
// `process_reminder_event`. El mensaje no se confirma hasta que la RPC termina.
export function crearProcesadorSupabase(supabase: SupabaseClient): ProcesadorAviso {
  return {
    async procesar(event: ReminderEvent): Promise<ResultadoProcesamiento> {
      const { data, error } = await supabase.rpc("process_reminder_event", { p_event: event });
      if (error) {
        // Fallo temporal (red, gateway, base de datos indisponible): el consumidor
        // hará Back y se reintentará. La RPC no dejó resultado persistido.
        throw new Error("No se pudo procesar el recordatorio en Supabase.");
      }
      const outcome = (data as RespuestaProcesamiento | null | undefined)?.outcome;
      if (typeof outcome !== "string" || !desenlaces.has(outcome as ResultadoProcesamiento)) {
        // Respuesta inesperada del RPC: incompatibilidad interna, no reintentable.
        return "PERMANENT_ERROR";
      }
      return outcome as ResultadoProcesamiento;
    },
  };
}
