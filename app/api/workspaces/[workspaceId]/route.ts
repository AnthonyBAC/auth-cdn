import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";

export async function GET(_: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;

  const { data, error } = await session.supabase
    .from("workspaces")
    .select("id, name, location_name, latitude, longitude, timezone")
    .eq("id", workspaceId)
    .is("archived_at", null)
    .single();

  if (error) return apiError("NOT_FOUND", "Workspace not found.");
  return NextResponse.json({ workspace: data });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;

  const { data, error } = await session.supabase
    .from("workspaces")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", workspaceId)
    .is("archived_at", null)
    .select("id")
    .single();

  if (error || !data) return apiError("FORBIDDEN", "Only workspace owners can delete workspaces.");
  return new NextResponse(null, { status: 204 });
}
