import { createRequire } from "node:module";

import { leerConfiguracionPuente } from "./configuracion";
import type { ClienteMq } from "./ibm-mq";
import { crearServidorResumen } from "./servidor";
import { crearSolicitanteMq } from "./solicitante";

async function main() {
  const config = leerConfiguracionPuente(process.env);

  // Carga diferida: Next.js nunca importa el cliente nativo de IBM MQ.
  const require = createRequire(import.meta.url);
  const mq = require("ibmmq") as ClienteMq;

  const solicitante = crearSolicitanteMq(mq, config);
  const servidor = crearServidorResumen(solicitante, config.MQ_SUMMARY_BRIDGE_TOKEN);

  const detener = () => servidor.close(() => process.exit(0));
  process.on("SIGINT", detener);
  process.on("SIGTERM", detener);

  servidor.on("error", () => {
    console.error("No se pudo abrir el puerto del puente de resúmenes.");
    process.exitCode = 1;
  });

  servidor.listen(config.MQ_SUMMARY_BRIDGE_PORT, config.MQ_SUMMARY_BRIDGE_HOST, () => {
    console.log(JSON.stringify({
      proceso: "resumen-puente",
      resultado: "ESCUCHANDO",
      host: config.MQ_SUMMARY_BRIDGE_HOST,
      puerto: config.MQ_SUMMARY_BRIDGE_PORT
    }));
  });
}

main().catch(() => {
  console.error(
    "No se pudo iniciar el puente de resúmenes. Revisa variables de entorno, certificados y cliente nativo IBM MQ."
  );
  process.exitCode = 1;
});
