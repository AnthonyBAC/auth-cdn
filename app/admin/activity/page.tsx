import { redirect } from "next/navigation";

import { ActivityDashboard } from "@/components/admin/activity-dashboard";
import { isActivityAdmin } from "@/lib/auth/activity-admin";
import { requireUser } from "@/lib/auth/require-user";

export default async function ActivityPage() {
  const session = await requireUser();
  if (session.error) {
    redirect(session.error.status === 401 ? "/login?redirectTo=%2Fadmin%2Factivity" : "/workspaces");
  }
  if (!isActivityAdmin(session.user)) redirect("/workspaces");

  return (
    <div className="grid">
      <h1 style={{ margin: 0 }}>Dashboard de tarjetas</h1>
      <ActivityDashboard />
    </div>
  );
}
