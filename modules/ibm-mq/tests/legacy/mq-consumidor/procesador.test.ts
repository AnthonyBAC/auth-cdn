// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ReminderEvent } from "../../../domain/contrato";
import { crearProcesadorSupabase } from "../../../legacy/mq-consumidor/procesador";

const evento: ReminderEvent = {
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

function crearCliente(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient;
}

describe("Procesador Supabase", () => {
  it("delega en la RPC con el evento y devuelve el desenlace persistido", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "PROCESSED" }, error: null });
    const procesador = crearProcesadorSupabase(crearCliente(rpc));

    await expect(procesador.procesar(evento)).resolves.toBe("PROCESSED");
    expect(rpc).toHaveBeenCalledWith("process_reminder_event", { p_event: evento });
  });

  it.each(["ALREADY_PROCESSED", "CANCELLED", "EXPIRED", "PERMANENT_ERROR"] as const)(
    "propaga el desenlace %s",
    async (outcome) => {
      const rpc = vi.fn().mockResolvedValue({ data: { outcome }, error: null });
      const procesador = crearProcesadorSupabase(crearCliente(rpc));
      await expect(procesador.procesar(evento)).resolves.toBe(outcome);
    },
  );

  it("propaga un fallo temporal como excepción para forzar el Back", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const procesador = crearProcesadorSupabase(crearCliente(rpc));

    await expect(procesador.procesar(evento)).rejects.toThrow(/Supabase/);
  });

  it("devuelve un error permanente ante una respuesta inesperada", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "algo-raro" }, error: null });
    const procesador = crearProcesadorSupabase(crearCliente(rpc));

    await expect(procesador.procesar(evento)).resolves.toBe("PERMANENT_ERROR");
  });
});
