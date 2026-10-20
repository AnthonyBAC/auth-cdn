// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRestMq, readRestConfig } from "@/lib/mq/rest";

const id = `ID:${"A".repeat(48)}`;
const env = { MQ_REST_BASE_URL: "https://mq.example/ibmmq/rest/v3", MQ_QUEUE_MANAGER: "QM",
  MQ_PRODUCER_USERNAME: "producer", MQ_PRODUCER_PASSWORD: "private-producer", MQ_USERNAME: "consumer", MQ_PASSWORD: "private-consumer" };
const config = readRestConfig(env);
afterEach(() => vi.useRealTimers());
describe("IBM MQ REST v3", () => {
  it("requires HTTPS, credentials and distinct queues", () => {
    expect(() => readRestConfig({ ...env, MQ_REST_BASE_URL: "http://mq.example/ibmmq/rest/v3" })).toThrow();
    expect(() => readRestConfig({ ...env, MQ_QUEUE: config.MQ_BACKOUT_QUEUE })).toThrow();
    expect(() => readRestConfig({ ...env, MQ_PASSWORD: "" })).toThrow();
  });
  it("publishes persistent text with TTL in milliseconds and private server authentication", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 201, headers: { "ibm-mq-md-messageId": id } }));
    await expect(createRestMq(config, "producer", f).send(config.MQ_QUEUE, "{}", { expiresAt: "2026-10-19T12:00:10Z" })).resolves.toBe(id);
    const init = f.mock.calls[0][1];
    expect(init.method).toBe("POST"); expect(init.redirect).toBe("error");
    expect(init.headers["ibm-mq-md-persistence"]).toBe("persistent");
    expect(init.headers["ibm-mq-md-expiry"]).toBe("10000");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("producer:private-producer").toString("base64")}`);
  });
  it("browses without removing and keeps v3 IDs for selectors", async () => {
    const f = vi.fn().mockResolvedValue(new Response("hello", { headers: { "ibm-mq-md-messageId": id, "ibm-mq-md-correlationId": id.toLowerCase().replace("id:", "ID:") } }));
    const result = await createRestMq(config, "consumer", f).browse(config.MQ_QUEUE, { correlationId: id });
    expect(result).toMatchObject({ id, body: "hello", correlationId: id });
    expect(f.mock.calls[0][0].searchParams.get("correlationId")).toBe(id);
    expect(f.mock.calls[0][1].method).toBe("GET"); expect(f).toHaveBeenCalledTimes(1);
  });
  it("deletes only the captured message ID", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const mq = createRestMq(config, "consumer", f);
    await mq.remove(config.MQ_QUEUE, id);
    expect(f.mock.calls[0][0].searchParams.get("messageId")).toBe(id);
    expect(f.mock.calls[0][1].method).toBe("DELETE");
    await expect(mq.remove(config.MQ_QUEUE, "")).rejects.toThrow("INVALID_MESSAGE_ID");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("treats 204 as empty and rejects arbitrary queues or reply destinations", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const mq = createRestMq(config, "consumer", f);
    await expect(mq.browse(config.MQ_QUEUE)).resolves.toBeNull();
    await expect(mq.send("OTHER.Q", "secret")).rejects.toThrow("QUEUE_NOT_ALLOWED");
    await expect(mq.send(config.MQ_QUEUE, "secret", { replyTo: "OTHER.Q" })).rejects.toThrow("REPLY_QUEUE_NOT_ALLOWED");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("does not retry ambiguous POSTs or leak credentials/response bodies", async () => {
    const f = vi.fn().mockRejectedValue(new Error("private-consumer"));
    await expect(createRestMq(config, "consumer", f).send(config.MQ_QUEUE, "sensitive")).rejects.toThrow("TRANSPORT_UNCONFIRMED");
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockResolvedValue(new Response("private-host-and-user", { status: 403 }));
    const error = await createRestMq(config, "consumer", g).browse(config.MQ_QUEUE).catch((e) => e);
    expect(error.message).not.toContain("private"); expect(error.status).toBe(403);
  });
  it("refuses expired publication before making a request", async () => {
    const f = vi.fn();
    await expect(createRestMq(config, "producer", f).send(config.MQ_QUEUE, "{}", { expiresAt: "2000-01-01T00:00:00Z" })).rejects.toThrow("EXPIRED");
    expect(f).not.toHaveBeenCalled();
  });
});
