import { requireUser } from "@/lib/auth/require-user";
import { cardOperation } from "@/lib/cards/operaciones";
import { cardCompletionInput } from "@/lib/validation/programacion";

export async function POST(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const session = await requireUser();
  if (session.error) return session.error;
  const { cardId } = await params;
  return cardOperation(request, cardId, cardCompletionInput, session.supabase, "complete_card", (input) => ({
    expected_version: input.expectedVersion
  }));
}
