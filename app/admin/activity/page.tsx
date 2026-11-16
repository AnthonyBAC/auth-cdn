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
      <h1 style={{ margin: 0 }}>Dashboard de actividad</h1>
      {process.env.KAFKA_ENABLED === "true" && (process.env.KAFKA_METRICS_TOKEN?.length ?? 0) >= 32
        ? <ActivityDashboard />
        : <p className="panel">Las métricas de Kafka no están configuradas en este entorno.</p>}
    </div>
  );
}