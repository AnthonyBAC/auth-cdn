import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reminderEventSchema } from "../domain/contrato";
import { captureNext, processJob, type InboxJob, type Output } from "./inbox";
import { createRestMq, readRestConfig, type RestConfig } from "../infrastructure/rest";
import { createInboxStore, createMqDatabase, rpc } from "../infrastructure/store";
import { calcularEstadisticas, resumenReplySchema, resumenRequestSchema, type ResumenReply } from "../domain/resumen";
import { crearResumenStore } from "../infrastructure/tablero";
import { publishNext } from "./productor";
import { createMessageAuthentication, MessageAuthenticationError, withMessageSigning, type MessageAuthentication } from "../infrastructure/message-jwt";

const reservation = z.object({ eventId: z.string().uuid(), lockToken: z.string().uuid(), payload: z.unknown() });

export function quarantine(config: RestConfig, job: InboxJob, reason = "RETRIES_EXHAUSTED"): Output {
  return { queue: config.MQ_BACKOUT_QUEUE, purpose: "QUARANTINE", body: JSON.stringify({ schemaVersion: 1, type: "MQ_REST_QUARANTINE",
    inboxId: job.id, sourceQueue: job.queue_name, messageId: job.message_id, reason, attempts: job.attempts,
    originalBody: job.body }) };
}

export function createCloudMq(config = readRestConfig(), database?: SupabaseClient,
  authentication: MessageAuthentication = createMessageAuthentication(config)) {
  let deadline = Number.POSITIVE_INFINITY;
  const timeout = () => {
    const remaining = Math.floor(deadline - Date.now());
    if (remaining <= 0) throw new Error("CLOUD_BUDGET_EXHAUSTED");
    return Math.min(5000, remaining);
  };
  const db = database ?? createMqDatabase(timeout);
  const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init,
    signal: AbortSignal.any([init?.signal ?? new AbortController().signal, AbortSignal.timeout(timeout())]) });
  const producer = withMessageSigning(createRestMq(config, "producer", boundedFetch), authentication);
  const consumer = withMessageSigning(createRestMq(config, "consumer", boundedFetch), authentication);
  const inbox = createInboxStore(db, config.MQ_QUEUE_MANAGER);
  const summaryStore = crearResumenStore(db);

  async function handle(job: InboxJob): Promise<Output | null> {
    let authenticatedBody: string;
    try {
      authenticatedBody = await authentication.verify(job.queue_name, job.body,
        { correlationId: job.correlation_id, replyTo: job.reply_to });
    } catch (error) {
      if (error instanceof MessageAuthenticationError) return quarantine(config, job, error.code);
      throw error;
    }
    let body: unknown;
    try { body = JSON.parse(authenticatedBody); } catch { return quarantine(config, job, "MALFORMED_JSON"); }
    if (job.queue_name === config.MQ_QUEUE) {
      const parsed = reminderEventSchema.safeParse(body);
      if (!parsed.success) return quarantine(config, job, "INVALID_REMINDER");
      const result = await rpc<{ outcome: string }>(db, "process_reminder_event", { p_event: parsed.data });
      if (result.outcome === "PERMANENT_ERROR") return quarantine(config, job, "PERMANENT_ERROR");
      if (!["PROCESSED", "ALREADY_PROCESSED", "CANCELLED", "EXPIRED"].includes(result.outcome)) throw new Error("RETRYABLE_ERROR");
      return null;
    }
    if (job.queue_name === config.MQ_SUMMARY_REPLY_QUEUE) return null;
    if (job.queue_name !== config.MQ_SUMMARY_REQUEST_QUEUE) return quarantine(config, job, "INVALID_SOURCE");
    const parsed = resumenRequestSchema.safeParse(body);
    if (!parsed.success) return quarantine(config, job, "INVALID_REQUEST");
    if (job.reply_to !== config.MQ_SUMMARY_REPLY_QUEUE && job.reply_to !== `${config.MQ_SUMMARY_REPLY_QUEUE}@${config.MQ_QUEUE_MANAGER}`) {
      return quarantine(config, job, "INVALID_REPLY_DESTINATION");
    }
    const request = parsed.data;
    if (Date.parse(request.expiresAt) <= Date.now()) return null;
    const result = await summaryStore.consultar(request.boardId, request.userId);
    const reply: ResumenReply = { schemaVersion: 1, requestId: request.requestId, boardId: request.boardId,
      generatedAt: new Date().toISOString(), ...(result.ok
        ? { status: "OK", stats: calcularEstadisticas(result.cards) }
        : { status: "ERROR", stats: null, error: { code: result.code, message: "El tablero no está disponible para este usuario." } }) };
    return { queue: config.MQ_SUMMARY_REPLY_QUEUE, body: JSON.stringify(reply), correlationId: job.message_id,
      expiresAt: new Date(Date.now() + 60000).toISOString() };
  }
  async function work(id?: string) {
    const job = await inbox.claim(id);
    if (!job) return "EMPTY";
    return await processJob(consumer, inbox, job, handle, (j) => quarantine(config, j)) ? "DONE" : "RETRY";
  }
  async function publish() {
    return publishNext({
      async claim() {
        const data = await rpc<unknown>(db, "claim_notification_event");
        if (data === null) return null;
        const parsed = reservation.parse(data);
        return { eventId: parsed.eventId, lockToken: parsed.lockToken, payload: parsed.payload };
      },
      finish: (eventId, token, result) => rpc<boolean>(db, "finish_notification_event", {
        p_event_id: eventId, p_lock_token: token, p_result: result
      })
    }, { async publish(event) { await producer.send(config.MQ_QUEUE, JSON.stringify(event), { expiresAt: event.expiresAt }); } });
  }

  async function tick(budgetMs = 35000, limit = 10) {
    const until = deadline = Date.now() + budgetMs;
    const stats = { published: 0, captured: 0, worked: 0, errors: 0 };
    await rpc(db, "enqueue_due_reminders", { p_limit: 100 });
    for (let i = 0; i < limit && Date.now() < until; i++) {
      try {
        const result = await work();
        if (result !== "EMPTY") stats.worked++;
        if (result === "RETRY") stats.errors++;
      } catch { stats.errors++; }
      if (Date.now() >= until) break;
      try {
        const result = await publish();
        if (result === "PUBLISHED") stats.published++;
        else if (result !== "EMPTY") stats.errors++;
      } catch { stats.errors++; }
      for (const queue of [config.MQ_QUEUE, config.MQ_SUMMARY_REQUEST_QUEUE]) {
        if (Date.now() >= until) break;
        try { if (await captureNext(consumer, inbox, queue)) stats.captured++; } catch { stats.errors++; }
      }
    }
    return stats;
  }

  async function summary(input: { boardId: string; userId: string }): Promise<ResumenReply> {
    const request = resumenRequestSchema.parse({ ...input, schemaVersion: 1, requestId: randomUUID(),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30000).toISOString() });
    deadline = Date.now() + 20000;
    const messageId = await producer.send(config.MQ_SUMMARY_REQUEST_QUEUE, JSON.stringify(request), {
      replyTo: config.MQ_SUMMARY_REPLY_QUEUE, expiresAt: request.expiresAt
    });
    // Inline responder plus Cron recovery: interactive requests cannot depend on
    // a one-minute Cron cadence. All operations still pass through real MQ queues.
    let requestInboxId: string | null = null;
    while (Date.now() < deadline) {
      if (!requestInboxId) {
        try { requestInboxId = await captureNext(consumer, inbox, config.MQ_SUMMARY_REQUEST_QUEUE, { messageId }); }
        catch { /* A captured request may already exist after an uncertain DELETE. */ }
        if (!requestInboxId) {
          const { data, error } = await db.from("mq_rest_inbox").select("id")
            .eq("qmgr", config.MQ_QUEUE_MANAGER).eq("queue_name", config.MQ_SUMMARY_REQUEST_QUEUE)
            .eq("message_id", messageId).maybeSingle();
          if (error) throw new Error("No se pudo recuperar la solicitud.");
          requestInboxId = data?.id ?? null;
        }
      }
      if (requestInboxId) await work(requestInboxId);
      try { await captureNext(producer, inbox, config.MQ_SUMMARY_REPLY_QUEUE, { correlationId: messageId }); }
      catch { /* Read the durable reply even if its DELETE response was lost. */ }
      const { data, error } = await db.from("mq_rest_inbox").select("id,body,correlation_id,reply_to")
        .eq("qmgr", config.MQ_QUEUE_MANAGER).eq("queue_name", config.MQ_SUMMARY_REPLY_QUEUE)
        .eq("correlation_id", messageId).order("created_at").limit(1).maybeSingle();
      if (error) throw new Error("No se pudo recuperar la respuesta.");
      if (data) {
        let authenticatedBody: string;
        try {
          authenticatedBody = await authentication.verify(config.MQ_SUMMARY_REPLY_QUEUE, data.body,
            { correlationId: data.correlation_id, replyTo: data.reply_to });
        } catch (error) {
          if (error instanceof MessageAuthenticationError) await work(data.id);
          throw error;
        }
        const reply = resumenReplySchema.parse(JSON.parse(authenticatedBody));
        if (reply.requestId !== request.requestId || reply.boardId !== request.boardId) throw new Error("INVALID_REPLY");
        const access = await summaryStore.consultar(input.boardId, input.userId);
        if (!access.ok) return { schemaVersion: 1, requestId: request.requestId, boardId: input.boardId,
          status: "ERROR", generatedAt: new Date().toISOString(), error: { code: access.code, message: "Acceso al tablero no disponible." } };
        return reply;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("SUMMARY_TIMEOUT");
  }
  return { tick, async summary(input: { boardId: string; userId: string }) {
    try { return await summary(input); }
    catch (error) {
      if (Date.now() >= deadline) throw new Error("SUMMARY_TIMEOUT");
      throw error;
    }
  } };
}
