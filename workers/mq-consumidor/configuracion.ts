import { z } from "zod";

const requerido = z.string().trim().min(1);

// Reutiliza los mismos nombres de variables del productor para que ambos procesos
// apunten al mismo gestor, canal y cola. Añade solo ajustes de consumo.
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: requerido,
  MQ_QUEUE_MANAGER: requerido.max(48),
  MQ_QUEUE: requerido.max(48),
  MQ_CHANNEL: requerido.max(20),
  MQ_CONNECTION_NAME: requerido,
  MQ_USERNAME: requerido,
  MQ_PASSWORD: z.string().min(1),
  // Sin opción para desactivar TLS. Ambos extremos deben acordar el cifrado.
  MQ_TLS_CIPHER_SPEC: z.enum(["TLS_AES_256_GCM_SHA384", "TLS_AES_128_GCM_SHA256", "ECDHE_RSA_AES_256_GCM_SHA384", "ECDHE_RSA_AES_128_GCM_SHA256"]),
  MQ_TLS_PEER_NAME: requerido.refine(value => !value.includes("*"), "Usa la identidad concreta del certificado."),
  MQ_TLS_KEY_REPOSITORY: requerido,
  MQ_TLS_KEY_REPOSITORY_PASSWORD: z.string().optional(),
  MQ_TLS_CERTIFICATE_LABEL: z.string().optional(),
  // Tiempo de espera de MQGET (MQGMO_WAIT) cuando la cola está vacía.
  MQ_CONSUMER_WAIT_MS: z.coerce.number().int().min(1000).max(3_600_000).default(5000),
  // Espera entre reintentos tras un fallo de conexión o de procesamiento.
  MQ_CONSUMER_INTERVAL_MS: z.coerce.number().int().min(1000).max(300_000).default(5000)
});

export type ConsumerConfig = z.infer<typeof schema>;

export function readConsumerConfig(env: Record<string, string | undefined>): ConsumerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Solo nombres de variables, nunca sus valores.
    throw new Error(`Revisa la configuración del consumidor: ${result.error.issues.map(issue => issue.path.join(".")).join(", ")}.`);
  }
  return result.data;
}
