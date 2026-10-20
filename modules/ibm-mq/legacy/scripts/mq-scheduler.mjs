// Proceso de servidor independiente. Nunca importar desde el navegador.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const interval = Number(process.env.MQ_SCHEDULER_INTERVAL_MS ?? 30000);
const batch = Number(process.env.MQ_SCHEDULER_BATCH_SIZE ?? 100);
const once = process.argv.includes("--once");
if (!url || !key || !Number.isInteger(interval) || interval < 1000 ||
    !Number.isInteger(batch) || batch < 1 || batch > 1000) {
  console.error("Configura Supabase, su clave de servicio y los límites válidos del scheduler.");
  process.exit(1);
}
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
let stopping = false;
let timer;
let wake;
function stop() { stopping = true; clearTimeout(timer); wake?.(); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
do {
  try {
    const { data, error } = await client.rpc("enqueue_due_reminders", { p_limit: batch })
      .abortSignal(AbortSignal.timeout(15000));
    if (error) throw error;
    console.log(JSON.stringify({ proceso: "scheduler", resultado: data }));
  } catch {
    // No imprimir credenciales, cabeceras ni respuestas que puedan contener secretos.
    console.error("No se pudieron preparar los avisos. Revisa conexión, credenciales y migración 0006.");
    if (once) process.exitCode = 1;
  }
  if (once || stopping) break;
  await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, interval); });
  wake = undefined;
} while (!stopping);
