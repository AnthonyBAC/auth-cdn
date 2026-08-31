import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { createToken, hashToken } from "@/lib/auth/tokens";
import { invitationInput } from "@/lib/validation/domain";

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;
  const parsed = invitationInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Invitation input is invalid.", parsed.error.flatten());

  const token = createToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await session.supabase
    .from("invitations")
    .insert({
      workspace_id: workspaceId,
      email: parsed.data.email,
      role: parsed.data.role,
      token_hash: hashToken(token),
      expires_at: expiresAt,
      created_by_user_id: session.user.id
    })
    .select("id, email, role, expires_at")
    .single();

  if (error) return apiError("FORBIDDEN", "Only workspace owners can invite members.");
  return NextResponse.json({ invitation: data, token }, { status: 201 });
}
