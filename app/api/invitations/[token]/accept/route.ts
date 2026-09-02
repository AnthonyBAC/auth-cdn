import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { hashToken } from "@/lib/auth/tokens";

export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { token } = await params;
  const { data: invitation } = await session.supabase
    .from("invitations")
    .select("id, workspace_id, email, role, expires_at, accepted_at, revoked_at")
    .eq("token_hash", await hashToken(token))
    .single();

  if (!invitation || invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() < Date.now()) {
    return apiError("NOT_FOUND", "Invitation is invalid or expired.");
  }
  if (invitation.email !== session.user.email?.toLowerCase()) {
    return apiError("FORBIDDEN", "This invitation belongs to another email address.");
  }

  const { error } = await session.supabase.from("memberships").upsert({
    workspace_id: invitation.workspace_id,
    user_id: session.user.id,
    role: invitation.role,
    status: "active"
  });
  if (error) return apiError("BAD_REQUEST", error.message);

  await session.supabase.from("invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invitation.id);
  return NextResponse.json({ workspaceId: invitation.workspace_id });
}
