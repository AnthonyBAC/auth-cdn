// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { procesarSiguiente, type ReceptorMensajes, type ResultadoProcesamiento } from "../../../legacy/mq-consumidor/consumidor";

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

function receptorFalso(cuerpo: string | null, backoutCount = 0) {
  const llamadas: string[] = [];
  const boq: Array<{ motivo: string; backoutCount: number; eventId?: string }> = [];
  const receptor: ReceptorMensajes = {
    async recibir() {
      llamadas.push("recibir");
      return cuerpo === null ? null : { cuerpo, backoutCount };
    },
    async confirmar() {
      llamadas.push("confirmar");
    },
    async revertir() {
      llamadas.push("revertir");
    },
    async moverABoq(_mensaje, diagnostico) {
      llamadas.push("moverABoq");
      boq.push({
        motivo: diagnostico.motivo,
        backoutCount: diagnostico.backoutCount,
        eventId: diagnostico.eventId,
      });
    },
    async cerrar() {
      llamadas.push("cerrar");
    },
  };
  return { receptor, llamadas, boq };
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

  it("deriva a la Backout Queue un error permanente devuelto por el procesador", async () => {
    const { receptor, llamadas, boq } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => "PERMANENT_ERROR");

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("BACKOUT");
    expect(llamadas).toEqual(["recibir", "moverABoq"]);
    expect(boq).toEqual([
      { motivo: "ERROR_PERMANENTE", backoutCount: 0, eventId: evento.eventId },
    ]);
  });

  it("confirma sin volver a notificar un evento ya procesado", async () => {
    const { receptor, llamadas } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => "ALREADY_PROCESSED");

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("ALREADY_PROCESSED");
    expect(llamadas).toEqual(["recibir", "confirmar"]);
  });

  it("envía a la Backout Queue un JSON inválido sin invocar al procesador", async () => {
    const { receptor, llamadas, boq } = receptorFalso("{no-es-json");
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("BACKOUT");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "moverABoq"]);
    expect(boq).toEqual([{ motivo: "MENSAJE_MALFORMADO", backoutCount: 0, eventId: undefined }]);
  });

  it("envía a la Backout Queue mensajes que no cumplen el contrato", async () => {
    const { receptor, llamadas, boq } = receptorFalso(JSON.stringify({ ...evento, cardId: "no-es-uuid" }));
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("BACKOUT");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "moverABoq"]);
    expect(boq[0].motivo).toBe("MENSAJE_MALFORMADO");
  });

  it("envía a la Backout Queue tipos de evento no permitidos", async () => {
    const { receptor, llamadas, boq } = receptorFalso(JSON.stringify({ ...evento, eventType: "TASK_DELETED" }));
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("BACKOUT");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "moverABoq"]);
    expect(boq[0].motivo).toBe("MENSAJE_MALFORMADO");
  });

  it("descarta mensajes expirados sin invocar al procesador ni enviarlos a la BOQ", async () => {
    const { receptor, llamadas, boq } = receptorFalso(JSON.stringify(evento));
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, posterior)).resolves.toBe("DISCARDED");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir", "confirmar"]);
    expect(boq).toEqual([]);
  });

  it("reintenta con rollback mientras no se alcanza el umbral", async () => {
    const { receptor, llamadas, boq } = receptorFalso(JSON.stringify(evento), 2);
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => "RETRYABLE_ERROR");

    await expect(procesarSiguiente(receptor, { procesar }, vigente, 5)).resolves.toBe("RETRYABLE_ERROR");
    expect(llamadas).toEqual(["recibir", "revertir"]);
    expect(boq).toEqual([]);
  });

  it("deriva a la Backout Queue al alcanzar el umbral de reintentos", async () => {
    const { receptor, llamadas, boq } = receptorFalso(JSON.stringify(evento), 4);
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => "RETRYABLE_ERROR");

    await expect(procesarSiguiente(receptor, { procesar }, vigente, 5)).resolves.toBe("BACKOUT");
    expect(llamadas).toEqual(["recibir", "moverABoq"]);
    expect(boq).toEqual([
      { motivo: "REINTENTOS_AGOTADOS", backoutCount: 4, eventId: evento.eventId },
    ]);
  });

  it("deriva a la Backout Queue cuando el procesamiento lanza al alcanzar el umbral", async () => {
    const { receptor, llamadas, boq } = receptorFalso(JSON.stringify(evento), 4);
    const procesar = vi.fn(async (): Promise<ResultadoProcesamiento> => {
      throw new Error("Supabase no disponible");
    });

    await expect(procesarSiguiente(receptor, { procesar }, vigente, 5)).resolves.toBe("BACKOUT");
    expect(llamadas).toEqual(["recibir", "moverABoq"]);
    expect(boq[0]).toMatchObject({ motivo: "REINTENTOS_AGOTADOS", eventId: evento.eventId });
  });

  it("no confirma ni revierte cuando la cola está vacía", async () => {
    const { receptor, llamadas } = receptorFalso(null);
    const procesar = vi.fn();

    await expect(procesarSiguiente(receptor, { procesar }, vigente)).resolves.toBe("EMPTY");
    expect(procesar).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["recibir"]);
  });
});
