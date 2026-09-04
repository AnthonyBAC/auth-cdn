import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { hashToken } from "@/lib/auth/tokens";

export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { token } = await params;

  const { data: workspaceId, error } = await session.supabase.rpc("accept_invitation", {
    token_hash_input: await hashToken(token)
  });

  if (error) {
    if (error.code === "42501") {
      return apiError("FORBIDDEN", "This invitation belongs to another email address.");
    }
    return apiError("BAD_REQUEST", error.message);
  }

  if (!workspaceId) {
    return apiError("NOT_FOUND", "Invitation is invalid or expired.");
  }

  return NextResponse.json({ workspaceId });
}
