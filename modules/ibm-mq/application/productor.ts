import { reminderEventSchema, type ReminderEvent } from "../domain/contrato";

export type Reservation = { eventId: string; lockToken: string; payload: unknown };
export type Result = "PUBLISHED" | "RETRY" | "INVALID";
export interface PublicationStore {
  claim(): Promise<Reservation | null>;
  finish(eventId: string, token: string, result: Result): Promise<boolean>;
}
export interface Broker { publish(event: ReminderEvent): Promise<void> }

export async function publishNext(store: PublicationStore, broker: Broker) {
  const reservation = await store.claim();
  if (!reservation) return "EMPTY";
  const parsed = reminderEventSchema.safeParse(reservation.payload);
  if (!parsed.success || parsed.data.eventId !== reservation.eventId) {
    const saved = await store.finish(reservation.eventId, reservation.lockToken, "INVALID");
    return saved ? "INVALID" : "LEASE_LOST";
  }
  try {
    await broker.publish(parsed.data);
  } catch {
    const saved = await store.finish(reservation.eventId, reservation.lockToken, "RETRY");
    return saved ? "RETRY" : "LEASE_LOST";
  }
  // Un error de BD después del commit MQ NO se trata como fallo del broker.
  // La reserva vencerá y se reenviará el mismo eventId; el consumidor debe deduplicar.
  const saved = await store.finish(reservation.eventId, reservation.lockToken, "PUBLISHED");
  return saved ? "PUBLISHED" : "LEASE_LOST";
}
