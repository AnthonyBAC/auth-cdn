// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorPuenteResumen, solicitarResumenRemoto } from "@/lib/mq/resumen-cliente";

const reply = {
  schemaVersion: 1,
  requestId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
  status: "OK",
  generatedAt: "2026-10-19T12:00:00.000Z",
  stats: { totalActive: 1, pending: 1, completed: 0, overdue: 0 }
};

const input = {
  boardId: reply.boardId,
  userId: "33333333-3333-4333-8333-333333333333"
};

beforeEach(() => {
  vi.stubEnv("MQ_SUMMARY_BRIDGE_URL", "http://127.0.0.1:4100");
  vi.stubEnv("MQ_SUMMARY_BRIDGE_TOKEN", "token-interno-de-prueba");
  vi.stubEnv("MQ_SUMMARY_HTTP_TIMEOUT_MS", "5000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Cliente del puente de resúmenes", () => {
  it("envía el token interno y valida la respuesta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reply }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(solicitarResumenRemoto(input)).resolves.toEqual(reply);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/resumen",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-mq-bridge-token": "token-interno-de-prueba" })
      })
    );
  });

  it("traduce el timeout del puente a 504", async () => {
    const abort = new Error("timeout");
    abort.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(solicitarResumenRemoto(input)).rejects.toMatchObject({
      status: 504,
      code: "GATEWAY_TIMEOUT"
    });
  });

  it("conserva el código de error controlado del puente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "MQ_ERROR", message: "Sin conexión." } }),
          { status: 502 }
        )
      )
    );

    const error = await solicitarResumenRemoto(input).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ErrorPuenteResumen);
    expect(error).toMatchObject({
      status: 502,
      code: "MQ_ERROR",
      message: "Sin conexión."
    });
  });

  it("rechaza una respuesta que no cumple el contrato", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ reply: { status: "OK" } }), { status: 200 }))
    );

    await expect(solicitarResumenRemoto(input)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_REPLY"
    });
  });

  it("no llama al puente si falta el token interno", async () => {
    vi.stubEnv("MQ_SUMMARY_BRIDGE_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(solicitarResumenRemoto(input)).rejects.toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
