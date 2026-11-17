import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

import { leerConfiguracionRespondedor } from "./configuracion";
import { crearReceptorResumen, type ClienteMq } from "./ibm-mq";
import { procesarSiguienteResumen, type ResultadoCicloResumen } from "./respondedor";
import { crearResumenStore } from "../../infrastructure/tablero";

async function main() {
  const config = leerConfiguracionRespondedor(process.env);

  // Carga diferida: Next.js nunca importa el cliente nativo de IBM MQ.
  const require = createRequire(import.meta.url);
  const mq = require("ibmmq") as ClienteMq;

  const supabase = createClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );

  const receptor = crearReceptorResumen(mq, config);
  const store = crearResumenStore(supabase);
  const opciones = {
    maxAttempts: config.MQ_SUMMARY_MAX_ATTEMPTS,
    replyQueue: config.MQ_SUMMARY_REPLY_QUEUE
  };

  const once = process.argv.includes("--once");
  const controlador = new AbortController();
  const detener = () => controlador.abort();
  process.on("SIGINT", detener);
  process.on("SIGTERM", detener);

  try {
    while (!controlador.signal.aborted) {
      let resultado: ResultadoCicloResumen | undefined;
      try {
        resultado = await procesarSiguienteResumen(receptor, store, opciones);
        console.log(JSON.stringify({ proceso: "resumen-respondedor", resultado }));
        if (once && resultado === "RETRY") process.exitCode = 1;
      } catch {
        console.error(
          "Fallo al procesar resúmenes desde IBM MQ. Revisa TLS, certificados, permisos y Supabase."
        );
        await receptor.cerrar().catch(() => undefined);
        if (once) process.exitCode = 1;
      }

      if (once) break;

      // Recibir ya espera en MQ cuando la cola está vacía; solo se retrocede
      // ante errores recuperables para no saturar el broker.
      if (resultado !== undefined && resultado !== "RETRY") continue;
      await delay(config.MQ_SUMMARY_INTERVAL_MS, undefined, { signal: controlador.signal }).catch(
        () => undefined
      );
    }
  } finally {
    process.off("SIGINT", detener);
    process.off("SIGTERM", detener);
    await receptor.cerrar();
  }
}

main().catch(() => {
  console.error(
    "No se pudo iniciar el respondedor de resúmenes. Revisa variables de entorno, certificados y cliente nativo IBM MQ."
  );
  process.exitCode = 1;
});
