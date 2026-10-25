import { z } from "zod";

export const reminderKinds = ["TASK_REMINDER_DUE", "TASK_OVERDUE"] as const;
export const reminderStatuses = ["SCHEDULED", "QUEUED", "PROCESSED", "CANCELLED", "EXPIRED", "FAILED"] as const;
export const outboxStatuses = ["PENDING", "PROCESSING", "PUBLISHED", "FAILED", "CANCELLED", "EXPIRED"] as const;

// Contrato común del productor y consumidor. Nunca transportar la sesión JWT.
export const reminderEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  eventType: z.enum(reminderKinds),
  reminderId: z.string().uuid(),
  cardId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  scheduleVersion: z.number().int().positive().max(2_147_483_647),
  occurredAt: z.string().datetime(),
  expiresAt: z.string().datetime()
}).strict().refine(
  (event) => Date.parse(event.expiresAt) > Date.parse(event.occurredAt),
  { message: "La expiración debe ser posterior a la creación del evento.", path: ["expiresAt"] }
);

export type ReminderEvent = z.infer<typeof reminderEventSchema>;
export type ReminderKind = typeof reminderKinds[number];
export type ReminderStatus = typeof reminderStatuses[number];
export type OutboxStatus = typeof outboxStatuses[number];
