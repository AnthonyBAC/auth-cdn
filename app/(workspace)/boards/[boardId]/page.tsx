import { redirect } from "next/navigation";

import { BoardView } from "@/components/board/board-view";
import { ContextPanel } from "@/components/context/context-panel";
import { canManageContent, type WorkspaceRole } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/weather/context";
import { openMeteoProvider } from "@/lib/weather/provider";

type BoardWorkspace = {
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
};

type BoardWithWorkspace = {
  workspaces: BoardWorkspace | BoardWorkspace[] | null;
};

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: board } = await supabase
    .from("boards")
    .select("id, title, workspace_id, workspaces(id, name, location_name, latitude, longitude, timezone)")
    .eq("id", boardId)
    .is("archived_at", null)
    .single();
  if (!board) redirect("/workspaces");

  const [{ data: membership }, { data: lists }] = await Promise.all([
    supabase.from("memberships").select("role").eq("workspace_id", board.workspace_id).eq("user_id", user.id).eq("status", "active").single(),
    supabase.from("lists").select("id, title, position, cards(id, title, description, position, list_id)").eq("board_id", boardId).is("archived_at", null).order("position")
  ]);
  if (!membership) redirect("/workspaces");

  const boardWithWorkspace = board as unknown as BoardWithWorkspace;
  const workspace = Array.isArray(boardWithWorkspace.workspaces) ? boardWithWorkspace.workspaces[0] : boardWithWorkspace.workspaces;
  const context = await getWorkspaceContext(
    workspace?.location_name && workspace.latitude !== null && workspace.longitude !== null && workspace.timezone
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
      <ContextPanel context={context} />
      <BoardView boardId={boardId} title={board.title} lists={lists ?? []} canEdit={canManageContent(membership.role as WorkspaceRole)} />
    </section>
  );
}
