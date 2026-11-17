import { z } from "zod";

export const RESUMEN_SCHEMA_VERSION = 1;

export const resumenErrorCodes = [
  "INVALID_REQUEST",
  "EXPIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL_ERROR"
] as const;

const uuid = z.string().uuid();
const isoDate = z.string().datetime();

export const resumenRequestSchema = z
  .object({
    schemaVersion: z.literal(RESUMEN_SCHEMA_VERSION),
    requestId: uuid,
    boardId: uuid,
    userId: uuid,
    createdAt: isoDate,
    expiresAt: isoDate
  })
  .strict()
  .refine(
    (request) => Date.parse(request.expiresAt) > Date.parse(request.createdAt),
    { message: "La expiración debe ser posterior a la creación de la solicitud.", path: ["expiresAt"] }
  );

export const resumenStatsSchema = z
  .object({
    totalActive: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative()
  })
  .strict()
  .refine(
    (stats) => stats.totalActive === stats.pending + stats.completed + stats.overdue,
    { message: "El total debe ser la suma de pendientes, completadas y vencidas.", path: ["totalActive"] }
  );

export const resumenReplySchema = z
  .object({
    schemaVersion: z.literal(RESUMEN_SCHEMA_VERSION),
    requestId: uuid,
    boardId: uuid,
    status: z.enum(["OK", "ERROR"]),
    generatedAt: isoDate,
    stats: resumenStatsSchema.nullable().optional(),
    error: z
      .object({
        code: z.enum(resumenErrorCodes),
        message: z.string().trim().min(1).max(500)
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict()
  .superRefine((reply, context) => {
    if (reply.status === "OK") {
      if (!reply.stats) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Una respuesta OK debe incluir estadísticas.",
          path: ["stats"]
        });
      }
      if (reply.error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Una respuesta OK no debe incluir error.",
          path: ["error"]
        });
      }
      return;
    }

    if (!reply.error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Una respuesta ERROR debe incluir un error controlado.",
        path: ["error"]
      });
    }
    if (reply.stats) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Una respuesta ERROR no debe incluir estadísticas.",
        path: ["stats"]
      });
    }
  });

export type ResumenRequest = z.infer<typeof resumenRequestSchema>;
export type ResumenStats = z.infer<typeof resumenStatsSchema>;
export type ResumenReply = z.infer<typeof resumenReplySchema>;
export type ResumenErrorCode = typeof resumenErrorCodes[number];

// Entrada mínima para clasificar tarjetas activas ya filtradas por el worker.
export type TarjetaResumen = {
  completedAt: string | null;
  dueAt: string | null;
};

// Categorías mutuamente excluyentes:
// - completed: tiene completed_at.
// - overdue: no completada y due_at < now.
// - pending: no completada, sin due_at o con due_at >= now.
// Una tarjeta sin fecha límite nunca es vencida; cuenta como pendiente.
export function calcularEstadisticas(cards: TarjetaResumen[], now: Date = new Date()): ResumenStats {
  const reference = now.getTime();
  let pending = 0;
  let completed = 0;
  let overdue = 0;

  for (const card of cards) {
    if (card.completedAt !== null) {
      completed += 1;
      continue;
    }

    const due = card.dueAt === null ? null : Date.parse(card.dueAt);
    if (due !== null && Number.isFinite(due) && due < reference) {
      overdue += 1;
    } else {
      pending += 1;
    }
  }

  return {
    totalActive: pending + completed + overdue,
    pending,
    completed,
    overdue
  };
}

// MQ usa décimas de segundo para MQMD.Expiry. Redondea hacia abajo y nunca
// devuelve 0: una expiración ya cumplida debe rechazarse antes de publicar.
export function expiracionEnDecimas(expiresAt: string, now = Date.now()): number {
  const remaining = Math.floor((Date.parse(expiresAt) - now) / 100);
  if (!Number.isFinite(remaining) || remaining < 1) {
    throw new Error("La solicitud ya expiró.");
  }
  return Math.min(remaining, 2_147_483_647);
}

export const UUID_DESCONOCIDO = "00000000-0000-4000-8000-000000000000";
