import { redirect } from "next/navigation";

import { ContextPanel } from "@/components/context/context-panel";
import { BoardList } from "@/components/workspace/board-list";
import { canManageContent, type WorkspaceRole } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/weather/context";
import { openMeteoProvider } from "@/lib/weather/provider";

export default async function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: membership }, { data: workspace }, { data: boards }] = await Promise.all([
    supabase.from("memberships").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).eq("status", "active").single(),
    supabase.from("workspaces").select("id, name, location_name, latitude, longitude, timezone").eq("id", workspaceId).single(),
    supabase.from("boards").select("id, title, position").eq("workspace_id", workspaceId).is("archived_at", null).order("position")
  ]);

  if (!membership || !workspace) redirect("/workspaces");

  const context = await getWorkspaceContext(
    workspace.location_name && workspace.latitude !== null && workspace.longitude !== null && workspace.timezone
      ? {
          locationName: workspace.location_name,
          latitude: workspace.latitude,
          longitude: workspace.longitude,
          timezone: workspace.timezone
        }
      : null,
    openMeteoProvider
  );

  return (
    <section className="grid">
      <h1>{workspace.name}</h1>
      <ContextPanel context={context} />
      <BoardList workspaceId={workspaceId} boards={boards ?? []} canEdit={canManageContent(membership.role as WorkspaceRole)} />
    </section>
  );
}
