import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { listInput } from "@/lib/validation/domain";

export async function PATCH(request: Request, { params }: { params: Promise<{ listId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { listId } = await params;
  const parsed = listInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "List input is invalid.", parsed.error.flatten());
  const { data, error } = await session.supabase
    .from("lists")
    .update({ title: parsed.data.title, position: parsed.data.position })
    .eq("id", listId)
    .select("id, title, position")
    .single();
  if (error) return apiError("FORBIDDEN", "You do not have permission to update this list.");
  return NextResponse.json({ list: data });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ listId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { listId } = await params;
  const { error } = await session.supabase.from("lists").update({ archived_at: new Date().toISOString() }).eq("id", listId);
  if (error) return apiError("FORBIDDEN", "You do not have permission to archive this list.");
  return new NextResponse(null, { status: 204 });
}
