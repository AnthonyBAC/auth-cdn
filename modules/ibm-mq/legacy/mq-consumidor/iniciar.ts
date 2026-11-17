import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { readConsumerConfig } from "./configuracion";
import { procesarSiguiente, type ResultadoCiclo } from "./consumidor";
import { crearReceptorMq, type ClienteMq } from "./ibm-mq";
import { crearProcesadorSupabase } from "./procesador";

async function main() {
  const config = readConsumerConfig(process.env);
  // Carga diferida: la aplicación Next.js nunca carga las bibliotecas nativas de MQ.
  const require = createRequire(import.meta.url);
  const mq = require("ibmmq") as ClienteMq;
  const supabase = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const receptor = crearReceptorMq(mq, config);
  const procesador = crearProcesadorSupabase(supabase);
  const once = process.argv.includes("--once");
  const controlador = new AbortController();
  const detener = () => controlador.abort();
  process.on("SIGINT", detener);
  process.on("SIGTERM", detener);

  try {
    while (!controlador.signal.aborted) {
      let resultado: ResultadoCiclo | undefined;
      try {
        resultado = await procesarSiguiente(
          receptor,
          procesador,
          new Date(),
          config.MQ_BACKOUT_THRESHOLD
        );
        console.log(JSON.stringify({ proceso: "consumidor", resultado }));
        if (once && resultado === "RETRYABLE_ERROR") process.exitCode = 1;
      } catch {
        console.error("Fallo al consumir desde IBM MQ. Revisa TLS, certificados, permisos y la conexión.");
        if (once) process.exitCode = 1;
      }
      if (once) break;
      // La lectura espera en MQ; solo se retrocede ante reintento o error para no saturar.
      if (resultado !== undefined && resultado !== "RETRYABLE_ERROR") continue;
      await delay(config.MQ_CONSUMER_INTERVAL_MS, undefined, { signal: controlador.signal }).catch(() => undefined);
    }
  } finally {
    process.off("SIGINT", detener);
    process.off("SIGTERM", detener);
    await receptor.cerrar();
  }
}

main().catch(() => {
  console.error("No se pudo iniciar el consumidor. Revisa variables de entorno, certificados y cliente nativo IBM MQ.");
  process.exitCode = 1;
});
