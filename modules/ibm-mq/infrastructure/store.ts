import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { InboxJob, InboxStore } from "../application/inbox";

export function createMqDatabase(timeout: () => number = () => 5000) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase de servidor no está configurado.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeout()) }) } });
}

export async function rpc<T>(db: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`No se pudo completar ${name}.`);
  return data as T;
}

export function createInboxStore(db: SupabaseClient, qmgr: string): InboxStore {
  function change(job: InboxJob, action: string, output?: unknown) {
    return rpc<boolean>(db, "mq_rest_update", { p_id: job.id, p_token: job.lock_token, p_action: action, p_output: output ?? null });
  }
  return {
    capture: (queue, m) => rpc<string>(db, "mq_rest_capture", { p_qmgr: qmgr, p_queue: queue, p_message_id: m.id,
      p_body: m.body, p_correlation_id: m.correlationId, p_reply_to: m.replyTo }),
    claim: (id) => rpc<InboxJob | null>(db, "mq_rest_claim", { p_qmgr: qmgr, p_id: id ?? null }),
    output: (job, output) => change(job, "OUTPUT", output),
    finish: (job) => change(job, "DONE"),
    retry: (job) => change(job, "RETRY")
  };
}
