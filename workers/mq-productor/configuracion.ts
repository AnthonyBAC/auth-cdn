import { z } from "zod";

const required = z.string().trim().min(1);
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: required,
  MQ_QUEUE_MANAGER: required.max(48),
  MQ_QUEUE: required.max(48),
  MQ_CHANNEL: required.max(20),
  MQ_CONNECTION_NAME: required,
  MQ_USERNAME: required,
  MQ_PASSWORD: z.string().min(1),
  // Sin opción para desactivar TLS. Ambos extremos deben acordar el cifrado.
  MQ_TLS_CIPHER_SPEC: z.enum(["TLS_AES_256_GCM_SHA384", "TLS_AES_128_GCM_SHA256", "ECDHE_RSA_AES_256_GCM_SHA384", "ECDHE_RSA_AES_128_GCM_SHA256"]),
  MQ_TLS_PEER_NAME: required.refine(value => !value.includes("*"), "Usa la identidad concreta del certificado."),
  MQ_TLS_KEY_REPOSITORY: required,
  MQ_TLS_KEY_REPOSITORY_PASSWORD: z.string().optional(),
  MQ_TLS_CERTIFICATE_LABEL: z.string().optional(),
  MQ_PRODUCER_INTERVAL_MS: z.coerce.number().int().min(1000).max(300000).default(5000)
});
export type ProducerConfig = z.infer<typeof schema>;
export function readProducerConfig(env: Record<string, string | undefined>): ProducerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Solo nombres de variables, nunca sus valores.
    throw new Error(`Revisa la configuración del productor: ${result.error.issues.map(issue => issue.path.join(".")).join(", ")}.`);
  }
  return result.data;
}

export function expiryTenths(expiresAt: string, now = Date.now()) {
  const remaining = Math.floor((Date.parse(expiresAt) - now) / 100);
  if (!Number.isFinite(remaining) || remaining < 1) throw new Error("El aviso ya expiró.");
  return Math.min(remaining, 2_147_483_647);
}
