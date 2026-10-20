import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { readProducerConfig } from "./configuracion";
import { createMqBroker } from "./ibm-mq";
import { publishNext, type PublicationStore } from "../../application/productor";

const reservationSchema = z.object({eventId:z.string().uuid(),lockToken:z.string().uuid(),payload:z.unknown()});
async function main() {
  const config = readProducerConfig(process.env);
  // Carga diferida: la aplicación Next.js nunca carga las bibliotecas nativas de MQ.
  const require = createRequire(import.meta.url);
  const mq: typeof import("ibmmq") = require("ibmmq");
  const client = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const store: PublicationStore = {
    async claim() {
      const {data,error} = await client.rpc("claim_notification_event").abortSignal(AbortSignal.timeout(15000));
      if (error) throw new Error("No se pudo reservar el evento.");
      if (data === null) return null;
      const parsed = reservationSchema.parse(data);
      return {...parsed,payload:parsed.payload};
    },
    async finish(eventId, token, result) {
      const {data,error} = await client.rpc("finish_notification_event", {
        p_event_id:eventId,p_lock_token:token,p_result:result
      }).abortSignal(AbortSignal.timeout(15000));
      if (error || typeof data !== "boolean") throw new Error("No se pudo registrar el resultado.");
      return data;
    }
  };
  const broker = createMqBroker(mq,config);
  const once = process.argv.includes("--once");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT",stop); process.on("SIGTERM",stop);
  try {
    while (!controller.signal.aborted) {
      let idle = true;
      try {
        const result = await publishNext(store,broker);
        console.log(JSON.stringify({proceso:"productor",resultado:result}));
        idle = result !== "PUBLISHED";
        if (once && !["PUBLISHED","EMPTY"].includes(result)) process.exitCode=1;
      } catch {
        console.error("Fallo del productor. Revisa MQ, TLS, Supabase y las migraciones; el evento conserva su estado recuperable.");
        if (once) process.exitCode=1;
      }
      if (once) break;
      if (idle) await delay(config.MQ_PRODUCER_INTERVAL_MS,undefined,{signal:controller.signal}).catch(() => undefined);
    }
  } finally {
    process.off("SIGINT",stop);process.off("SIGTERM",stop);
  }
}
main().catch(() => {
  console.error("No se pudo iniciar el productor. Revisa variables de entorno, certificados y cliente nativo IBM MQ.");
  process.exitCode=1;
});
