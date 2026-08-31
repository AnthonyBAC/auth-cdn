import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SupabaseDiagnosticsPage() {
  const supabase = await createSupabaseServerClient();
  const startedAt = Date.now();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  const authClientOk = !userError || userError.name === "AuthSessionMissingError";
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
          <dd>{authClientOk ? "Connected" : userError?.message}</dd>
          <dt>Signed in</dt>
          <dd>{user ? user.email : "No active session"}</dd>
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
