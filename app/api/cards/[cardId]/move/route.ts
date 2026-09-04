import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { cardMoveInput } from "@/lib/validation/domain";

export async function POST(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { cardId } = await params;
  const parsed = cardMoveInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Move input is invalid.", parsed.error.flatten());

  const { data: targetList } = await session.supabase.from("lists").select("id, board_id").eq("id", parsed.data.listId).single();
  const { data: card } = await session.supabase.from("cards").select("id, board_id").eq("id", cardId).single();
  if (!targetList || !card || targetList.board_id !== card.board_id) {
    return apiError("BAD_REQUEST", "Cards can only move to lists on the same board.");
  }

  const { data, error } = await session.supabase
    .from("cards")
    .update({ list_id: parsed.data.listId, position: parsed.data.position ?? 0 })
    .eq("id", cardId)
    .select("id, list_id, position")
    .single();
  if (error) return apiError("FORBIDDEN", "You do not have permission to move this card.");
  return NextResponse.json({ card: data });
}
