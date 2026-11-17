import { describe, expect, it } from "vitest";
import { reminderEventSchema } from "@/modules/ibm-mq/domain/contrato";

const event = {
  schemaVersion: 1,
  eventId: "f345a124-783e-4caa-830c-8930337b535f",
  eventType: "TASK_REMINDER_DUE",
  reminderId: "d13497cd-5063-459f-9f90-9dc78293eb49",
  cardId: "33086fde-719d-4724-9b05-b6f6947e0c59",
  workspaceId: "fe962a07-38d5-4124-a67f-09e631abf5e6",
  scheduleVersion: 1,
  occurredAt: "2026-10-18T18:00:00.000Z",
  expiresAt: "2026-10-20T18:00:00.000Z"
};

describe("contrato de recordatorios MQ", () => {
  it.each(["TASK_REMINDER_DUE", "TASK_OVERDUE"])("acepta %s", (eventType) => {
    expect(reminderEventSchema.parse({ ...event, eventType }).eventType).toBe(eventType);
  });
  it("rechaza credenciales y destinatarios enviados fuera del contrato", () => {
    expect(reminderEventSchema.safeParse({ ...event, accessToken: "sesion" }).success).toBe(false);
    expect(reminderEventSchema.safeParse({ ...event, userId: event.cardId }).success).toBe(false);
  });
  it.each([0, -1, 1.5, 2_147_483_648])("rechaza versión de programación inválida %s", (scheduleVersion) => {
    expect(reminderEventSchema.safeParse({ ...event, scheduleVersion }).success).toBe(false);
  });
  it("rechaza contratos desconocidos e identificadores inválidos", () => {
    expect(reminderEventSchema.safeParse({ ...event, schemaVersion: 2 }).success).toBe(false);
    expect(reminderEventSchema.safeParse({ ...event, reminderId: "no-es-uuid" }).success).toBe(false);
    expect(reminderEventSchema.safeParse({ ...event, eventType: "OTRO" }).success).toBe(false);
  });
  it("exige fechas UTC y una expiración posterior a la creación", () => {
    expect(reminderEventSchema.safeParse({ ...event, occurredAt: "2026-10-18T18:00:00" }).success).toBe(false);
    expect(reminderEventSchema.safeParse({ ...event, expiresAt: event.occurredAt }).success).toBe(false);
    expect(reminderEventSchema.safeParse({ ...event, expiresAt: "2026-10-17T18:00:00Z" }).success).toBe(false);
  });
});
