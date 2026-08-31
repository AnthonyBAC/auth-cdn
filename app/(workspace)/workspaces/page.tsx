import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form";
import { WorkspaceList } from "@/components/workspace/workspace-list";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type WorkspaceJoinRow = {
  role: string;
  workspaces: { id: string; name: string; location_name: string | null };
};

export default async function WorkspacesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("memberships")
    .select("role, workspaces(id, name, location_name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const workspaces = ((data ?? []) as unknown as WorkspaceJoinRow[]).map((row) => ({
    id: row.workspaces.id,
    name: row.workspaces.name,
    role: row.role,
    locationName: row.workspaces.location_name
  }));

  return (
    <section className="grid">
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Workspaces</h1>
        <SignOutButton />
      </div>
      <WorkspaceList workspaces={workspaces} />
      <CreateWorkspaceForm />
    </section>
  );
}
