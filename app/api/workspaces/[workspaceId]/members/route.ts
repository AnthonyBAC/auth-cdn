import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";

export async function GET(_: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;

  const { data, error } = await session.supabase
    .from("memberships")
    .select("user_id, role, status, profiles(id, email, name)")
    .eq("workspace_id", workspaceId)
    .neq("status", "removed")
    .order("created_at");

  if (error) return apiError("FORBIDDEN", "You do not have permission to view members.");
  return NextResponse.json({ members: data ?? [] });
}
