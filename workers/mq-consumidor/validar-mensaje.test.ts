import { describe, expect, it } from "vitest";
import { validarMensaje } from "./validar-mensaje";

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

describe("Validación del consumidor", () => {
  it("acepta un evento vigente", () => {
    const result = validarMensaje(
      JSON.stringify(evento),
      new Date("2026-10-19T18:00:00Z"),
    );

    expect(result.ok).toBe(true);
  });

  it("rechaza mensajes expirados", () => {
    const result = validarMensaje(
      JSON.stringify(evento),
      new Date("2026-10-21T18:00:00Z"),
    );

    expect(result).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
  });

  it("rechaza JSON inválido", () => {
    expect(validarMensaje("{invalid")).toEqual({
      ok: false,
      reason: "INVALID_MESSAGE",
    });
  });

  it("rechaza mensajes que no cumplen el contrato", () => {
    const result = validarMensaje(
      JSON.stringify({ ...evento, cardId: "no-es-un-uuid" }),
    );

    expect(result).toEqual({
      ok: false,
      reason: "INVALID_MESSAGE",
    });
  });

  it("rechaza tipos de evento no permitidos", () => {
    const result = validarMensaje(
      JSON.stringify({ ...evento, eventType: "TASK_DELETED" }),
    );

    expect(result).toEqual({
      ok: false,
      reason: "INVALID_MESSAGE",
    });
  });
});
