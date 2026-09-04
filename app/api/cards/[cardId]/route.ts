import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { cardInput } from "@/lib/validation/domain";

export async function PATCH(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { cardId } = await params;
  const parsed = cardInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Card input is invalid.", parsed.error.flatten());
  const { data, error } = await session.supabase
    .from("cards")
    .update({ title: parsed.data.title, description: parsed.data.description })
    .eq("id", cardId)
    .select("id, title, description")
    .single();
  if (error) return apiError("FORBIDDEN", "You do not have permission to update this card.");
  return NextResponse.json({ card: data });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { cardId } = await params;
  const { error } = await session.supabase.from("cards").update({ archived_at: new Date().toISOString() }).eq("id", cardId);
  if (error) return apiError("FORBIDDEN", "You do not have permission to archive this card.");
  return new NextResponse(null, { status: 204 });
}
