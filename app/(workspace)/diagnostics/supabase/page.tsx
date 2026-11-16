import { redirect } from "next/navigation";

import { isActivityAdmin } from "@/lib/auth/activity-admin";
import { requireUser } from "@/lib/auth/require-user";

export default async function SupabaseDiagnosticsPage() {
  const startedAt = Date.now();
  const session = await requireUser();
  if (session.error) {
    redirect(session.error.status === 401 ? "/login?redirectTo=%2Fdiagnostics%2Fsupabase" : "/workspaces");
  }
  const { supabase, user } = session;
  if (!isActivityAdmin(user)) redirect("/workspaces");

  const { data, error } = await supabase.from("workspaces").select("id, name").limit(3);

  return (
    <section className="grid">
      <h1>Supabase diagnostics</h1>
      <div className="panel">
        <dl className="diagnostics">
          <dt>Project URL</dt>
          <dd>{process.env.NEXT_PUBLIC_SUPABASE_URL ? "Configured" : "Missing"}</dd>
          <dt>Publishable key</dt>
          <dd>{process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "Configured" : "Missing"}</dd>
          <dt>Auth client</dt>
          <dd>Connected</dd>
          <dt>Signed in</dt>
          <dd>{user.email}</dd>
          <dt>Database query</dt>
          <dd>{error ? error.message : "Connected through RLS"}</dd>
          <dt>Visible workspaces</dt>
          <dd>{data?.length ?? 0}</dd>
          <dt>Latency</dt>
          <dd>{Date.now() - startedAt} ms</dd>
        </dl>
      </div>
    </section>
  );
}
