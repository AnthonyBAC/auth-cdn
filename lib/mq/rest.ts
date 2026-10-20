import { z } from "zod";

const configSchema = z.object({
  MQ_REST_BASE_URL: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.replace(/\/$/, "") === "/ibmmq/rest/v3";
  }, "Usa HTTPS y /ibmmq/rest/v3."),
  MQ_QUEUE_MANAGER: z.string().min(1).max(48),
  MQ_PRODUCER_USERNAME: z.string().min(1),
  MQ_PRODUCER_PASSWORD: z.string().min(1),
  MQ_USERNAME: z.string().min(1),
  MQ_PASSWORD: z.string().min(1),
  MQ_REST_TIMEOUT_MS: z.coerce.number().int().min(500).max(10000).default(4000),
  MQ_QUEUE: z.string().min(1).max(48).default("AUTHCDN.REMINDERS.Q"),
  MQ_BACKOUT_QUEUE: z.string().min(1).max(48).default("AUTHCDN.REMINDERS.BOQ"),
  MQ_SUMMARY_REQUEST_QUEUE: z.string().min(1).max(48).default("AUTHCDN.SUMMARY.REQUEST.Q"),
  MQ_SUMMARY_REPLY_QUEUE: z.string().min(1).max(48).default("AUTHCDN.SUMMARY.REPLY.Q")
}).refine((c) => new Set([c.MQ_QUEUE, c.MQ_BACKOUT_QUEUE, c.MQ_SUMMARY_REQUEST_QUEUE, c.MQ_SUMMARY_REPLY_QUEUE]).size === 4,
  "Las cuatro colas deben ser distintas.");

export type RestConfig = z.infer<typeof configSchema>;
export function readRestConfig(env: Record<string, string | undefined> = process.env): RestConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) throw new Error("Configuración REST MQ incompleta o inválida.");
  return parsed.data;
}

export class MqRestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`IBM MQ REST: ${code} (${status}).`);
  }
}

export type MqMessage = { id: string; body: string; correlationId: string | null; replyTo: string | null };
export type Selector = { messageId?: string; correlationId?: string };
export type SendOptions = { correlationId?: string; replyTo?: string; expiresAt?: string };
export interface MqTransport {
  browse(queue: string, selector?: Selector): Promise<MqMessage | null>;
  remove(queue: string, messageId: string): Promise<void>;
  send(queue: string, body: string, options?: SendOptions): Promise<string>;
}

function messageId(value: string | null): string {
  if (!value || !/^ID:[0-9a-f]{48}$/i.test(value)) throw new MqRestError(502, "INVALID_MESSAGE_ID");
  return `ID:${value.slice(3).toUpperCase()}`;
}

// v3 IDs retain ID:. No retries here: a POST timeout has an ambiguous outcome.
// The durable outbox/inbox owns retries with stable event/request identifiers.
export function createRestMq(config: RestConfig, role: "producer" | "consumer", fetcher: typeof fetch = fetch): MqTransport {
  const user = role === "producer" ? config.MQ_PRODUCER_USERNAME : config.MQ_USERNAME;
  const password = role === "producer" ? config.MQ_PRODUCER_PASSWORD : config.MQ_PASSWORD;
  const allowed = new Set([config.MQ_QUEUE, config.MQ_BACKOUT_QUEUE, config.MQ_SUMMARY_REQUEST_QUEUE, config.MQ_SUMMARY_REPLY_QUEUE]);
  async function call(queue: string, method: string, selector: Selector = {}, body?: string, options: SendOptions = {}) {
    if (!allowed.has(queue)) throw new MqRestError(400, "QUEUE_NOT_ALLOWED");
    const url = new URL(`${config.MQ_REST_BASE_URL.replace(/\/$/, "")}/messaging/qmgr/${encodeURIComponent(config.MQ_QUEUE_MANAGER)}/queue/${encodeURIComponent(queue)}/message`);
    if (selector.messageId) url.searchParams.set("messageId", messageId(selector.messageId));
    if (selector.correlationId) url.searchParams.set("correlationId", messageId(selector.correlationId));
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
      "ibm-mq-rest-csrf-token": "auth-cdn", Accept: "text/plain", "Accept-Charset": "UTF-8"
    };
    if (method === "POST") {
      headers["Content-Type"] = "text/plain;charset=utf-8";
      headers["ibm-mq-md-persistence"] = "persistent";
      if (options.correlationId) headers["ibm-mq-md-correlationId"] = messageId(options.correlationId);
      if (options.replyTo) {
        if (options.replyTo !== config.MQ_SUMMARY_REPLY_QUEUE) throw new MqRestError(400, "REPLY_QUEUE_NOT_ALLOWED");
        headers["ibm-mq-md-replyTo"] = options.replyTo;
      }
      if (options.expiresAt) {
        const expiry = Math.floor(Date.parse(options.expiresAt) - Date.now());
        if (!Number.isFinite(expiry) || expiry <= 0) throw new MqRestError(410, "EXPIRED");
        headers["ibm-mq-md-expiry"] = String(Math.min(expiry, 99999999900));
      }
    }
    let response: Response;
    try {
      response = await fetcher(url, { method, headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(config.MQ_REST_TIMEOUT_MS) });
    } catch {
      throw new MqRestError(503, "TRANSPORT_UNCONFIRMED");
    }
    if (!response.ok) {
      // Never expose the IBM response: it may contain usernames, hosts or message data.
      await response.body?.cancel();
      throw new MqRestError(response.status, "HTTP_ERROR");
    }
    return response;
  }
  return {
    async browse(queue, selector) {
      const response = await call(queue, "GET", selector);
      if (response.status === 204) return null;
      const id = messageId(response.headers.get("ibm-mq-md-messageId"));
      const correlation = response.headers.get("ibm-mq-md-correlationId");
      return { id, body: await response.text(), correlationId: correlation?.startsWith("ID:") ? messageId(correlation) : correlation, replyTo: response.headers.get("ibm-mq-md-replyTo") };
    },
    async remove(queue, id) {
      // DELETE only the ID already durably captured; never an unqualified DELETE.
      const response = await call(queue, "DELETE", { messageId: messageId(id) });
      await response.body?.cancel();
    },
    async send(queue, body, options) {
      const response = await call(queue, "POST", {}, body, options);
      await response.body?.cancel();
      return messageId(response.headers.get("ibm-mq-md-messageId"));
    }
  };
}
