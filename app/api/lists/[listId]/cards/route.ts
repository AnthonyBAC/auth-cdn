import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { cardInput } from "@/lib/validation/domain";

export async function POST(request: Request, { params }: { params: Promise<{ listId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { listId } = await params;
  const parsed = cardInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Card input is invalid.", parsed.error.flatten());

  const { data: list } = await session.supabase.from("lists").select("id, board_id").eq("id", listId).single();
  if (!list) return apiError("NOT_FOUND", "List not found.");

  const { count } = await session.supabase.from("cards").select("*", { count: "exact", head: true }).eq("list_id", listId);
  const { data, error } = await session.supabase
    .from("cards")
    .insert({ board_id: list.board_id, list_id: listId, title: parsed.data.title, description: parsed.data.description, position: count ?? 0 })
    .select("id, title, description, position, list_id")
    .single();
  if (error) return apiError("FORBIDDEN", "You do not have permission to create cards.");
  return NextResponse.json({ card: data }, { status: 201 });
}
