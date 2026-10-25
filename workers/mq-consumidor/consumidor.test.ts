// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { procesarSiguiente, type ReceptorMensajes, type ResultadoProcesamiento } from "./consumidor";

const evento = {
  schemaVersion: 1,
  eventId: "11111111-1111-4111-8111-111111111111",
  eventType: "TASK_REMINDER_DUE",
  reminderId: "22222222-2222-4222-8222-222222222222",
  cardId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  scheduleVersion: 1,
  occurredAt: "2026-10-18T18:00:00.000Z",
  expiresAt: "2026-10-20T18:00:00.000Z",
};

const vigente = new Date("2026-10-19T18:00:00Z");
const posterior = new Date("2026-10-21T18:00:00Z");

function receptorFalso(cuerpo: string | null) {
  const llamadas: string[] = [];
  const receptor: ReceptorMensajes = {
    async recibir() {
      llamadas.push("recibir");
      return cuerpo === null ? null : { cuerpo };
    },
    async confirmar() {
      llamadas.push("confirmar");
    },
    async revertir() {
      llamadas.push("revertir");
    },
    async cerrar() {
      llamadas.push("cerrar");
    },
  };
  return { receptor, llamadas };
}

describe("Consumidor (validación y confirmación)", () => {
  it("procesa y confirma solo después del procesador", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => {
      expect(llamadas).not.toContain("confirmar");
      return "PROCESSED";
    });

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("PROCESSED");
    expect(procesar).toHaveBeenCalledOnce();
    expect(llamadas).toEqual(["recibir", "confirmar"]);
  });

  it("revierte sin confirmar un resultado recuperable devuelto por el procesador", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => "RETRYABLE_ERROR");

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("RETRYABLE_ERROR");
    expect(llamadas).toEqual(["recibir", "revertir"]);
  });

  it("revierte y no confirma si el procesamiento lanza un error temporal", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => {
      throw new Error("Supabase no disponible");
    });

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("RETRYABLE_ERROR");
    expect(llamadas).toEqual(["recibir", "revertir"]);
    expect(llamadas).not.toContain("confirmar");
  });

  it("descarta un error permanente devuelto por el procesador y lo confirma", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => "PERMANENT_ERROR");

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("PERMANENT_ERROR");
    expect(llamadas).toEqual(["recibir", "confirmar"]);
  });

  it("confirma sin volver a notificar un evento ya procesado", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => "ALREADY_PROCESSED");

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("ALREADY_PROCESSED");
    expect(llamadas).toEqual(["recibir", "confirmar"]);
  });

  it("descarta JSON inválido sin invocar al procesador", async () => {
    const { receptor, llamadas } = receptorFalso("{no-es-json");
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("DISCARDED");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "confirmar"]);
  });

  it("descarta mensajes que no cumplen el contrato", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify({ ...evento, cardId: "no-es-uuid" }));
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("DISCARDED");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "confirmar"]);
  });

  it("descarta tipos de evento no permitidos", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify({ ...evento, eventType: "TASK_DELETED" }));
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("DISCARDED");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "confirmar"]);
  });

  it("descarta mensajes expirados sin invocar al procesador", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, posterior)).resolves.toBe("DISCARDED");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "confirmar"]);
  });

  it("no confirma ni revierte cuando la cola está vacía", async () => {
    const { receptor, llamadas } = receptorFalso(null);
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("EMPTY");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir"]);
  });
});
