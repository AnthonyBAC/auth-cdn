export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requestJson<T>(url: string, method = "GET", payload?: unknown): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
  } catch {
    throw new ApiRequestError("No se pudo conectar. Tus cambios siguen en el formulario; vuelve a intentarlo.", 0);
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(data?.error?.message ?? "No se pudo realizar la operación. Inténtalo nuevamente.", response.status);
  }
  if (data === null) throw new ApiRequestError("El servidor no devolvió una respuesta válida.", response.status);
  return data as T;
}
