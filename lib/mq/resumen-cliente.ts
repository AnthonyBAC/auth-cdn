import { resumenReplySchema, type ResumenReply } from "@/lib/mq/resumen";

export class ErrorPuenteResumen extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "ErrorPuenteResumen";
  }
}

function configuracion() {
  const base = (process.env.MQ_SUMMARY_BRIDGE_URL ?? "http://127.0.0.1:4100").replace(/\/+$/, "");
  const token = process.env.MQ_SUMMARY_BRIDGE_TOKEN;
  const rawTimeout = Number(process.env.MQ_SUMMARY_HTTP_TIMEOUT_MS ?? 12000);
  const timeoutMs = Number.isInteger(rawTimeout) && rawTimeout >= 1000 && rawTimeout <= 60000
    ? rawTimeout
    : 12000;

  if (!token) {
    throw new ErrorPuenteResumen(
      "El puente de resúmenes no está configurado.",
      503,
      "SERVICE_UNAVAILABLE"
    );
  }

  return { url: `${base}/resumen`, token, timeoutMs };
}

// Llamada servidor-a-servidor al proceso que posee el cliente nativo IBM MQ.
// El navegador nunca conoce esta URL ni el token interno.
export async function solicitarResumenRemoto(input: {
  boardId: string;
  userId: string;
}): Promise<ResumenReply> {
  const { url, token, timeoutMs } = configuracion();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-mq-bridge-token": token
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ErrorPuenteResumen(
        "El resumen superó el tiempo de espera.",
        504,
        "GATEWAY_TIMEOUT"
      );
    }
    throw new ErrorPuenteResumen(
      "No se pudo contactar al servicio de resúmenes.",
      503,
      "SERVICE_UNAVAILABLE"
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const code = typeof data?.error?.code === "string" ? data.error.code : "MQ_ERROR";
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : "El servicio de resúmenes no pudo completar la solicitud.";
    throw new ErrorPuenteResumen(message, response.status, code);
  }

  const parsed = resumenReplySchema.safeParse(data?.reply);
  if (!parsed.success) {
    throw new ErrorPuenteResumen(
      "El servicio de resúmenes devolvió una respuesta inválida.",
      502,
      "INVALID_REPLY"
    );
  }

  return parsed.data;
}
