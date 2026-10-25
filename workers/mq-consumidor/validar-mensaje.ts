import { reminderEventSchema, type ReminderEvent } from "../../lib/mq/contrato";

export type ValidacionMensaje =
  | { ok: true; event: ReminderEvent }
  | { ok: false; reason: "INVALID_MESSAGE" | "EXPIRED" };

export function validarMensaje(
  raw: string,
  now: Date = new Date(),
): ValidacionMensaje {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "INVALID_MESSAGE" };
  }

  const parsed = reminderEventSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_MESSAGE" };
  }

  if (Date.parse(parsed.data.expiresAt) <= now.getTime()) {
    return { ok: false, reason: "EXPIRED" };
  }

  return { ok: true, event: parsed.data };
}
