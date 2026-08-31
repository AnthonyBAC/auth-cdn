import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { boardInput } from "@/lib/validation/domain";

export async function GET(_: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;
  const { data, error } = await session.supabase
    .from("boards")
    .select("id, title, position, created_at")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("position", { ascending: true });

  if (error) return apiError("BAD_REQUEST", error.message);
  return NextResponse.json({ boards: data ?? [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;
  const parsed = boardInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Board input is invalid.", parsed.error.flatten());

  const { count } = await session.supabase.from("boards").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  const { data, error } = await session.supabase
    .from("boards")
    .insert({ workspace_id: workspaceId, title: parsed.data.title, position: count ?? 0 })
    .select("id, title, position")
    .single();

  if (error) return apiError("FORBIDDEN", "You do not have permission to create boards in this workspace.");
  return NextResponse.json({ board: data }, { status: 201 });
}
