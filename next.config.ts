import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  // El cliente nativo de IBM MQ se resuelve en tiempo de ejecución y no debe
  // empaquetarse con webpack. El file tracing de Next incluye automáticamente
  // el addon prebuilt, las .so del Redistributable Client y GSKit, pero NO los
  // archivos de DATOS (ccsid.tbl, iconv, catálogos de mensajes, etc.) que el
  // cliente carga en tiempo de ejecución y que son imprescindibles para MQCONNX.
  serverExternalPackages: ["ibmmq"],
  // Ruta raíz del trazado: evita que Next infiera un workspace padre distinto.
  outputFileTracingRoot: __dirname,
  // Incluye los archivos de datos del Redistributable Client de IBM MQ que el
  // tracing estándar no detecta. Sin ellos, MQCONNX falla con MQRC 2012
  // (MQRC_ENVIRONMENT_ERROR) porque no puede inicializar la conversión CCSID.
  // Se usan rutas FÍSICAS de .pnpm (no el enlace simbólico node_modules/ibmmq)
  // para no producir un paquete inválido por directorios enlazados (Vercel
  // issue #17348). ibmmq está fijado a 2.1.9, por lo que la ruta es estable.
  outputFileTracingIncludes: {
    "/api/mq/poc": [
      "./node_modules/.pnpm/ibmmq@2.1.9/node_modules/ibmmq/redist/lib/ccsid.tbl",
      "./node_modules/.pnpm/ibmmq@2.1.9/node_modules/ibmmq/redist/lib/ccsid_part2.tbl",
      "./node_modules/.pnpm/ibmmq@2.1.9/node_modules/ibmmq/redist/lib/amqtrc.fmt",
      "./node_modules/.pnpm/ibmmq@2.1.9/node_modules/ibmmq/redist/lib/ccdt_schema.json",
      "./node_modules/.pnpm/ibmmq@2.1.9/node_modules/ibmmq/redist/lib/amqlcelp*",
      "./node_modules/.pnpm/ibmmq@2.1.9/node_modules/ibmmq/redist/lib/iconv/**/*",
      "./node_modules/.pnpm/ibmmq@2.1.9/node_modules/ibmmq/redist/msg/**/*"
    ]
  }
};

export default nextConfig;
