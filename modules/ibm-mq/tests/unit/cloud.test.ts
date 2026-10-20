// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudMq } from "@/modules/ibm-mq/application/cloud";
import { readRestConfig } from "@/modules/ibm-mq/infrastructure/rest";
import type { InboxJob } from "@/modules/ibm-mq/application/inbox";

const f = vi.hoisted(() => ({ browse: vi.fn(), remove: vi.fn(), send: vi.fn(), capture: vi.fn(), claim: vi.fn(),
  output: vi.fn(), finish: vi.fn(), retry: vi.fn(), rpc: vi.fn(), consultar: vi.fn() }));
vi.mock("@/modules/ibm-mq/infrastructure/rest", async (original) => ({ ...await original<typeof import("@/modules/ibm-mq/infrastructure/rest")>(),
  createRestMq: () => ({ browse: f.browse, remove: f.remove, send: f.send }) }));
vi.mock("@/modules/ibm-mq/infrastructure/store", () => ({ rpc: (...args: unknown[]) => f.rpc(...args),
  createInboxStore: () => ({ capture: f.capture, claim: f.claim, output: f.output, finish: f.finish, retry: f.retry }) }));
vi.mock("../../infrastructure/tablero", () => ({ crearResumenStore: () => ({ consultar: f.consultar }) }));
const config = readRestConfig({ MQ_REST_BASE_URL: "https://mq.example/ibmmq/rest/v3", MQ_QUEUE_MANAGER: "QM",
  MQ_PRODUCER_USERNAME: "producer", MQ_PRODUCER_PASSWORD: "private", MQ_USERNAME: "consumer", MQ_PASSWORD: "private" });
const uuid = "11111111-1111-4111-8111-111111111111";
const id = `ID:${"A".repeat(48)}`;
const event = { schemaVersion: 1, eventId: uuid, eventType: "TASK_REMINDER_DUE", reminderId: uuid,
  cardId: uuid, workspaceId: uuid, scheduleVersion: 1, occurredAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" };
const job: InboxJob = { id: uuid, queue_name: config.MQ_QUEUE, message_id: id, body: JSON.stringify(event),
  state: "PENDING", correlation_id: null, reply_to: null, attempts: 1, output_attempts: 0, lock_token: uuid, output: null };
const db = { from: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks(); f.claim.mockResolvedValue(null); f.browse.mockResolvedValue(null);
  f.finish.mockResolvedValue(true); f.output.mockResolvedValue(true); f.retry.mockResolvedValue(true);
  f.send.mockResolvedValue(id); f.capture.mockResolvedValue(uuid);
  f.rpc.mockImplementation(async (_, name: string) => name === "claim_notification_event" ? null : { outcome: "PROCESSED" });
});
describe("cloud reminder and request/reply processing", () => {
  it("processes reminders through the existing idempotent RPC", async () => {
    f.claim.mockResolvedValueOnce(job);
    const result = await createCloudMq(config, db as never).tick(10000, 1);
    expect(f.rpc).toHaveBeenCalledWith(db, "process_reminder_event", { p_event: event });
    expect(f.finish).toHaveBeenCalledWith(job); expect(f.send).not.toHaveBeenCalled(); expect(result.errors).toBe(0);
  });
  it("routes malformed messages to the application BOQ with a stable diagnostic", async () => {
    f.claim.mockResolvedValueOnce({ ...job, body: "not json" });
    await createCloudMq(config, db as never).tick(10000, 1);
    expect(f.output.mock.calls[0][1]).toMatchObject({ queue: config.MQ_BACKOUT_QUEUE, purpose: "QUARANTINE" });
    expect(JSON.parse(f.output.mock.calls[0][1].body)).toMatchObject({ reason: "MALFORMED_JSON", inboxId: uuid });
  });
  it("publishes a correlated summary only after rechecking membership in Supabase", async () => {
    const request = { schemaVersion: 1, requestId: uuid, userId: uuid, boardId: uuid,
      createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" };
    f.claim.mockResolvedValueOnce({ ...job, queue_name: config.MQ_SUMMARY_REQUEST_QUEUE, reply_to: `${config.MQ_SUMMARY_REPLY_QUEUE}@QM`, body: JSON.stringify(request) });
    f.consultar.mockResolvedValue({ ok: true, cards: [{ dueAt: null, completedAt: null }] });
    await createCloudMq(config, db as never).tick(10000, 1);
    expect(f.consultar).toHaveBeenCalledWith(uuid, uuid);
    const output = f.output.mock.calls[0][1]; expect(output.correlationId).toBe(id);
    expect(JSON.parse(output.body)).toMatchObject({ requestId: uuid, boardId: uuid, status: "OK", stats: { pending: 1 } });
  });
  it("does not calculate or send to an arbitrary reply destination", async () => {
    const request = { schemaVersion: 1, requestId: uuid, userId: uuid, boardId: uuid,
      createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" };
    f.claim.mockResolvedValueOnce({ ...job, queue_name: config.MQ_SUMMARY_REQUEST_QUEUE, reply_to: "UNTRUSTED.Q", body: JSON.stringify(request) });
    await createCloudMq(config, db as never).tick(10000, 1);
    expect(f.consultar).not.toHaveBeenCalled(); expect(f.send.mock.calls[0][0]).toBe(config.MQ_BACKOUT_QUEUE);
  });
  it("does not mark PUBLISHED after an uncertain HTTP send", async () => {
    f.rpc.mockImplementation(async (_, name: string) => name === "claim_notification_event" ? { eventId: uuid, lockToken: uuid, payload: event } : true);
    f.send.mockRejectedValueOnce(new Error("network timeout"));
    const stats = await createCloudMq(config, db as never).tick(10000, 1);
    expect(f.rpc).toHaveBeenCalledWith(db, "finish_notification_event", { p_event_id: uuid, p_lock_token: uuid, p_result: "RETRY" });
    expect(stats.errors).toBe(1);
  });

  it("isolates two concurrent interactive summaries through MQ request/reply IDs", async () => {
    const broker: { queue: string; id: string; body: string; correlationId: string | null; replyTo: string | null }[] = [];
    const rows: InboxJob[] = [];
    let sequence = 0;
    f.send.mockImplementation(async (queue, body, options = {}) => {
      const messageId = `ID:${(++sequence).toString(16).padStart(48, '0')}`;
      broker.push({ queue, id: messageId, body, correlationId: options.correlationId ?? null, replyTo: options.replyTo ?? null });
      return messageId;
    });
    f.browse.mockImplementation(async (queue, selector = {}) => broker.find(m => m.queue === queue
      && (!selector.messageId || m.id === selector.messageId)
      && (!selector.correlationId || m.correlationId === selector.correlationId)) ?? null);
    f.remove.mockImplementation(async (_, messageId) => { const index = broker.findIndex(m => m.id === messageId); if (index >= 0) broker.splice(index, 1); });
    f.capture.mockImplementation(async (queue, message) => {
      const key = `inbox-${message.id}`;
      if (!rows.some(r => r.id === key)) rows.push({ ...job, id: key, queue_name: queue, message_id: message.id,
        body: message.body, reply_to: message.replyTo, correlation_id: message.correlationId });
      return key;
    });
    f.claim.mockImplementation(async key => { const row = rows.find(r => r.id === key && r.state !== 'DONE'); return row ? { ...row } : null; });
    f.output.mockImplementation(async (row, output) => { Object.assign(rows.find(r => r.id === row.id)!, { state: 'OUTPUT', output }); return true; });
    f.finish.mockImplementation(async row => { rows.find(r => r.id === row.id)!.state = 'DONE'; return true; });
    f.consultar.mockResolvedValue({ ok: true, cards: [] });
    db.from.mockImplementation(() => {
      const filters: Record<string,string> = {};
      const chain = { select: () => chain, eq: (key: string, value: string) => { filters[key] = value; return chain; },
        order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: rows.find(row =>
          Object.entries(filters).every(([key,value]) => key === 'qmgr' || row[key as keyof InboxJob] === value)) ?? null, error: null }) };
      return chain;
    });
    const firstBoard = uuid, secondBoard = "22222222-2222-4222-8222-222222222222";
    const [first, second] = await Promise.all([
      createCloudMq(config, db as never).summary({ boardId: firstBoard, userId: uuid }),
      createCloudMq(config, db as never).summary({ boardId: secondBoard, userId: uuid })
    ]);
    expect(first.status).toBe('OK'); expect(second.status).toBe('OK');
    expect(first.boardId).toBe(firstBoard); expect(second.boardId).toBe(secondBoard);
    expect(first.requestId).not.toBe(second.requestId);
    expect(broker).toHaveLength(0);
  });
});
