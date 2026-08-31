import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { workspaceInput } from "@/lib/validation/domain";

type WorkspaceJoinRow = {
  role: string;
  workspaces: { id: string; name: string; location_name: string | null; archived_at: string | null };
};

export async function GET() {
  const session = await requireUser();
  if ("error" in session) return session.error;

  const { data, error } = await session.supabase
    .from("memberships")
    .select("role, workspaces!inner(id, name, location_name, archived_at)")
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .is("workspaces.archived_at", null)
    .order("created_at", { ascending: true });

  if (error) return apiError("BAD_REQUEST", error.message);

  return NextResponse.json({
    workspaces: ((data ?? []) as unknown as WorkspaceJoinRow[]).map((row) => ({
      id: row.workspaces.id,
      name: row.workspaces.name,
      role: row.role,
      locationName: row.workspaces.location_name
    }))
  });
}

export async function POST(request: Request) {
  const session = await requireUser();
  if ("error" in session) return session.error;

  const parsed = workspaceInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Workspace input is invalid.", parsed.error.flatten());

  const { data: workspace, error } = await session.supabase.from("workspaces").insert({ name: parsed.data.name }).select("id, name").single();
  if (error) return apiError("BAD_REQUEST", error.message);

  const { error: membershipError } = await session.supabase.from("memberships").insert({
    workspace_id: workspace.id,
    user_id: session.user.id,
    role: "owner",
    status: "active"
  });
  if (membershipError) return apiError("BAD_REQUEST", membershipError.message);

  return NextResponse.json({ workspace: { ...workspace, role: "owner" } }, { status: 201 });
}
