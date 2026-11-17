import { z } from "zod";

const expectedVersion = z.number().int().positive().max(2_147_483_647);

export const cardScheduleInput = z.object({
  expectedVersion,
  dueAt: z.string().datetime({ offset: true }).nullable(),
  notifyAt: z.string().datetime({ offset: true }).nullable(),
  assigneeIds: z.array(z.string().uuid()).refine((ids) => new Set(ids).size === ids.length, "No repitas responsables.")
}).strict().superRefine((input, ctx) => {
  if ((input.dueAt === null) !== (input.notifyAt === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["notifyAt"], message: "Indica ambas fechas o elimina ambas." });
  } else if (input.dueAt && input.notifyAt && Date.parse(input.notifyAt) >= Date.parse(input.dueAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["notifyAt"], message: "El aviso debe ser anterior al vencimiento." });
  }
});

// El reloj de la base de datos valida que el aviso siga siendo futuro al guardar.
export const cardCompletionInput = z.object({ expectedVersion }).strict();
