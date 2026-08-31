import { redirect } from "next/navigation";
import Link from "next/link";

import { LocationSettings } from "@/components/context/location-settings";
import { MemberManagement, type Member } from "@/components/workspace/member-management";
import { canManageMembership, type WorkspaceRole } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: membership }, { data: workspace }, { data: members }] = await Promise.all([
    supabase.from("memberships").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).eq("status", "active").single(),
    supabase.from("workspaces").select("id, name, location_name, latitude, longitude, timezone").eq("id", workspaceId).single(),
    supabase.from("memberships").select("user_id, role, status, profiles(email, name)").eq("workspace_id", workspaceId).neq("status", "removed").order("created_at")
  ]);

  if (!membership || !workspace) redirect("/workspaces");
  const isOwner = canManageMembership(membership.role as WorkspaceRole);

  return (
    <section className="grid">
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>{workspace.name} settings</h1>
        <Link className="button secondary" href={`/workspaces/${workspaceId}`}>
          Back
        </Link>
      </div>
      <LocationSettings
        workspaceId={workspaceId}
        canEdit={isOwner}
        initial={{
          locationName: workspace.location_name ?? undefined,
          latitude: workspace.latitude ?? undefined,
          longitude: workspace.longitude ?? undefined,
          timezone: workspace.timezone ?? undefined
        }}
      />
      <MemberManagement workspaceId={workspaceId} members={(members ?? []) as unknown as Member[]} canManage={isOwner} />
    </section>
  );
}
