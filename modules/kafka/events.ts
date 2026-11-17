import { z } from "zod";

export const CARD_EVENTS_TOPIC = "auth-cdn.card-events.v1";

export const cardMovedEvent = z.object({
  eventId: z.string().uuid(),
  schemaVersion: z.literal(1),
  type: z.literal("CARD_MOVED"),
  occurredAt: z.string().datetime(),
  cardId: z.string().uuid(),
  boardId: z.string().uuid(),
  destinationListId: z.string().uuid()
});

export type CardMovedEvent = z.infer<typeof cardMovedEvent>;
