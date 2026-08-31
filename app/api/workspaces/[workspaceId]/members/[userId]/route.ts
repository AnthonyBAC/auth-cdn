import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { memberRoleInput } from "@/lib/validation/domain";

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string; userId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId, userId } = await params;
  const parsed = memberRoleInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Role input is invalid.", parsed.error.flatten());

  const { data: current } = await session.supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .single();
  const { count } = await session.supabase
    .from("memberships")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .eq("status", "active");
  if (current?.role === "owner" && parsed.data.role !== "owner" && (count ?? 0) <= 1) {
    return apiError("CONFLICT", "A workspace must keep at least one owner.");
  }

  const { data, error } = await session.supabase
    .from("memberships")
    .update({ role: parsed.data.role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id, role")
    .single();
  if (error) return apiError("FORBIDDEN", "Only workspace owners can change member roles.");
  return NextResponse.json({ member: data });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ workspaceId: string; userId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId, userId } = await params;

  const { data: current } = await session.supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .single();
  const { count } = await session.supabase
    .from("memberships")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .eq("status", "active");
  if (current?.role === "owner" && (count ?? 0) <= 1) {
    return apiError("CONFLICT", "A workspace must keep at least one owner.");
  }

  const { error } = await session.supabase
    .from("memberships")
    .update({ status: "removed" })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) return apiError("FORBIDDEN", "Only workspace owners can remove members.");
  return new NextResponse(null, { status: 204 });
}
