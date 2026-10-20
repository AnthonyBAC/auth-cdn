import { createCloudMq } from "./cloud";
import type { ResumenReply } from "../domain/resumen";

// Compatibility name for the route; the production localhost bridge is removed.
export class ErrorPuenteResumen extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

export async function solicitarResumenRemoto(input: { boardId: string; userId: string }): Promise<ResumenReply> {
  try { return await createCloudMq().summary(input); }
  catch (error) {
    if (error instanceof Error && error.message === "SUMMARY_TIMEOUT") {
      throw new ErrorPuenteResumen("El resumen superó el tiempo de espera.", 504, "GATEWAY_TIMEOUT");
    }
    throw new ErrorPuenteResumen("No se pudo completar el resumen mediante IBM MQ REST.", 503, "SERVICE_UNAVAILABLE");
  }
}
