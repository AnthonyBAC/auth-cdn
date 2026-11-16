import { redirect } from "next/navigation";

import { ActivityDashboard } from "@/components/admin/activity-dashboard";
import { isActivityAdmin } from "@/lib/auth/activity-admin";
import { requireUser } from "@/lib/auth/require-user";

import { getActivityMetricsConfig } from "@/modules/kafka/activity-config";

export default async function ActivityPage() {
  const session = await requireUser();
  if (session.error) {
    redirect(session.error.status === 401 ? "/login?redirectTo=%2Fadmin%2Factivity" : "/workspaces");
  }
  if (!isActivityAdmin(session.user)) redirect("/workspaces");

  const config = getActivityMetricsConfig();

  return (
    <div className="grid">
      <h1 style={{ margin: 0 }}>Dashboard de actividad</h1>
      {config.enabled
        ? <ActivityDashboard />
        : <p className="panel">{config.message}</p>}
    </div>
  );
}