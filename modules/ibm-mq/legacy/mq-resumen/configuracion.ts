import { z } from "zod";

const requerido = z.string().trim().min(1);
const nombreCola = requerido.max(48);
const cipherSpecs = [
  "ANY_TLS12_OR_HIGHER",
  "TLS_AES_256_GCM_SHA384",
  "TLS_AES_128_GCM_SHA256",
  "ECDHE_RSA_AES_256_GCM_SHA384",
  "ECDHE_RSA_AES_128_GCM_SHA256"
] as const;

const peerName = requerido.refine(
  (value) => !/(^|[^\\])\*/.test(value),
  "Los asteriscos literales del DN deben escaparse con \\*."
);

const mqComun = {
  MQ_QUEUE_MANAGER: requerido.max(48),
  MQ_CHANNEL: requerido.max(20),
  MQ_CONNECTION_NAME: requerido,
  MQ_TLS_CIPHER_SPEC: z.enum(cipherSpecs),
  MQ_TLS_PEER_NAME: peerName,
  MQ_TLS_KEY_REPOSITORY: requerido,
  MQ_TLS_KEY_REPOSITORY_PASSWORD: z.string().optional(),
  MQ_TLS_CERTIFICATE_LABEL: z.string().optional()
};

const colasResumen = {
  MQ_SUMMARY_REQUEST_QUEUE: nombreCola.default("AUTHCDN.SUMMARY.REQUEST.Q"),
  MQ_SUMMARY_REPLY_QUEUE: nombreCola.default("AUTHCDN.SUMMARY.REPLY.Q")
};

const solicitanteSchema = z
  .object({
    ...mqComun,
    ...colasResumen,

    // Credenciales del productor: PUT en Request y GET en Reply.
    MQ_PRODUCER_USERNAME: requerido,
    MQ_PRODUCER_PASSWORD: z.string().min(1),

    MQ_SUMMARY_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
    MQ_SUMMARY_REQUEST_TTL_MS: z.coerce.number().int().min(500).max(60_000).default(15_000)
  })
  .refine(
    (data) => data.MQ_SUMMARY_REQUEST_TTL_MS >= data.MQ_SUMMARY_TIMEOUT_MS,
    {
      message: "MQ_SUMMARY_REQUEST_TTL_MS debe ser mayor o igual que MQ_SUMMARY_TIMEOUT_MS.",
      path: ["MQ_SUMMARY_REQUEST_TTL_MS"]
    }
  )
  .refine(
    (data) => data.MQ_SUMMARY_REQUEST_QUEUE !== data.MQ_SUMMARY_REPLY_QUEUE,
    {
      message: "Las colas de solicitud y respuesta deben ser distintas.",
      path: ["MQ_SUMMARY_REPLY_QUEUE"]
    }
  );

const respondedorSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: requerido,

    ...mqComun,
    ...colasResumen,

    // Credenciales del consumidor: GET en Request y PUT en Reply.
    MQ_USERNAME: requerido,
    MQ_PASSWORD: z.string().min(1),

    MQ_SUMMARY_WAIT_MS: z.coerce.number().int().min(500).max(300_000).default(5_000),
    MQ_SUMMARY_INTERVAL_MS: z.coerce.number().int().min(250).max(300_000).default(2_000),
    MQ_SUMMARY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(3),
    MQ_SUMMARY_REPLY_TTL_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000)
  })
  .refine(
    (data) => data.MQ_SUMMARY_REQUEST_QUEUE !== data.MQ_SUMMARY_REPLY_QUEUE,
    {
      message: "Las colas de solicitud y respuesta deben ser distintas.",
      path: ["MQ_SUMMARY_REPLY_QUEUE"]
    }
  );

const puenteSchema = z.object({
  ...mqComun,
  ...colasResumen,

  MQ_PRODUCER_USERNAME: requerido,
  MQ_PRODUCER_PASSWORD: z.string().min(1),

  MQ_SUMMARY_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  MQ_SUMMARY_REQUEST_TTL_MS: z.coerce.number().int().min(500).max(60_000).default(15_000),

  MQ_SUMMARY_BRIDGE_HOST: z.string().trim().min(1).default("127.0.0.1"),
  MQ_SUMMARY_BRIDGE_PORT: z.coerce.number().int().min(1024).max(65_535).default(4100),
  MQ_SUMMARY_BRIDGE_TOKEN: z.string().min(16)
}).refine(
  (data) => data.MQ_SUMMARY_REQUEST_TTL_MS >= data.MQ_SUMMARY_TIMEOUT_MS,
  {
    message: "MQ_SUMMARY_REQUEST_TTL_MS debe ser mayor o igual que MQ_SUMMARY_TIMEOUT_MS.",
    path: ["MQ_SUMMARY_REQUEST_TTL_MS"]
  }
);

export type ConfiguracionSolicitante = z.infer<typeof solicitanteSchema>;
export type ConfiguracionRespondedor = z.infer<typeof respondedorSchema>;
export type ConfiguracionPuente = z.infer<typeof puenteSchema>;

function leer<T extends z.ZodTypeAny>(schema: T, env: Record<string, string | undefined>, proceso: string): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Solo se informan nombres de variables, nunca valores.
    throw new Error(
      `Revisa la configuración de ${proceso}: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}.`
    );
  }
  return result.data;
}

export function leerConfiguracionSolicitante(env: Record<string, string | undefined>) {
  return leer(solicitanteSchema, env, "solicitante de resúmenes");
}

export function leerConfiguracionRespondedor(env: Record<string, string | undefined>) {
  return leer(respondedorSchema, env, "respondedor de resúmenes");
}

export function leerConfiguracionPuente(env: Record<string, string | undefined>) {
  return leer(puenteSchema, env, "puente de resúmenes");
}
