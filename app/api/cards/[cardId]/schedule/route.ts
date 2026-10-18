import { requireUser } from "@/lib/auth/require-user";
import { cardOperation } from "@/lib/cards/operaciones";
import { cardScheduleInput } from "@/lib/validation/programacion";

export async function PATCH(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const session = await requireUser();
  if (session.error) return session.error;
  const { cardId } = await params;
  return cardOperation(request, cardId, cardScheduleInput, session.supabase, "schedule_card_reminders", (input) => ({
    expected_version: input.expectedVersion,
    due_at_input: input.dueAt,
    notify_at_input: input.notifyAt,
    assignee_ids: input.assigneeIds
  }));
}
