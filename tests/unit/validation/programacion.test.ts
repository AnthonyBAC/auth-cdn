import { describe, expect, it } from "vitest";
import { cardScheduleInput, cardCompletionInput } from "@/lib/validation/programacion";

const input = {
  expectedVersion: 1,
  dueAt: "2030-10-20T18:00:00Z",
  notifyAt: "2030-10-18T18:00:00Z",
  assigneeIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]
};

describe("programación de tarjetas", () => {
  it("acepta varios responsables o ninguno", () => {
    expect(cardScheduleInput.parse(input).assigneeIds).toHaveLength(2);
    expect(cardScheduleInput.parse({ ...input, assigneeIds: [] }).assigneeIds).toEqual([]);
  });
  it("rechaza responsables repetidos y campos de identidad falsificados", () => {
    expect(cardScheduleInput.safeParse({ ...input, assigneeIds: [input.assigneeIds[0], input.assigneeIds[0]] }).success).toBe(false);
    expect(cardScheduleInput.safeParse({ ...input, createdBy: input.assigneeIds[0] }).success).toBe(false);
  });
  it("exige las dos fechas, ordenadas y con zona horaria", () => {
    expect(cardScheduleInput.safeParse({ ...input, dueAt: null }).success).toBe(false);
    expect(cardScheduleInput.safeParse({ ...input, notifyAt: input.dueAt }).success).toBe(false);
    expect(cardScheduleInput.safeParse({ ...input, dueAt: "2030-10-20T18:00:00" }).success).toBe(false);
  });
  it("acepta eliminar fechas y fechas con desplazamiento horario", () => {
    expect(cardScheduleInput.safeParse({ ...input, dueAt: null, notifyAt: null }).success).toBe(true);
    expect(cardScheduleInput.safeParse({ ...input, dueAt: "2030-10-20T15:00:00-03:00" }).success).toBe(true);
  });
  it("finaliza con versión conocida y sin aceptar fecha de finalización enviada por cliente", () => {
    expect(cardCompletionInput.safeParse({ expectedVersion: 2 }).success).toBe(true);
    expect(cardCompletionInput.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(cardCompletionInput.safeParse({ expectedVersion: 2, completedAt: input.dueAt }).success).toBe(false);
  });
});
