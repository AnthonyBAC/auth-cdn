import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { boardInput } from "@/lib/validation/domain";

export async function GET(_: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { boardId } = await params;

  const { data: board, error } = await session.supabase
    .from("boards")
    .select("id, workspace_id, title, lists(id, title, position, cards(id, title, description, position, list_id, created_at, updated_at))")
    .eq("id", boardId)
    .is("archived_at", null)
    .single();

  if (error) return apiError("NOT_FOUND", "Board not found.");
  return NextResponse.json({ board });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { boardId } = await params;
  const parsed = boardInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Board input is invalid.", parsed.error.flatten());

  const { data, error } = await session.supabase.from("boards").update({ title: parsed.data.title }).eq("id", boardId).select("id, title").single();
  if (error) return apiError("FORBIDDEN", "You do not have permission to update this board.");
  return NextResponse.json({ board: data });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { boardId } = await params;
  const { error } = await session.supabase.from("boards").update({ archived_at: new Date().toISOString() }).eq("id", boardId);
  if (error) return apiError("FORBIDDEN", "You do not have permission to archive this board.");
  return new NextResponse(null, { status: 204 });
}
