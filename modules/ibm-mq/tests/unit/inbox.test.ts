// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { captureNext, processJob, type InboxJob } from "@/modules/ibm-mq/application/inbox";

const job: InboxJob = { id: "inbox", queue_name: "Q", message_id: `ID:${"A".repeat(48)}`,
  body: "{}", correlation_id: null, reply_to: null, state: "PENDING", attempts: 1, output_attempts: 0, lock_token: "lease", output: null };
const output = { queue: "BOQ", body: "diagnostic" };
function setup() {
  const order: string[] = [];
  const mq = { browse: vi.fn().mockResolvedValue({ id: job.message_id, body: "{}" }),
    remove: vi.fn(async () => { order.push("remove"); }), send: vi.fn(async () => { order.push("send"); return "id"; }) };
  const store = { capture: vi.fn(async () => { order.push("capture"); return "inbox"; }), claim: vi.fn(),
    output: vi.fn(async () => { order.push("output"); return true; }), finish: vi.fn(async () => { order.push("finish"); return true; }), retry: vi.fn().mockResolvedValue(true) };
  return { mq, store, order };
}
describe("durable REST handoff and recovery", () => {
  it("persists before destructive receive", async () => {
    const { mq, store, order } = setup();
    await captureNext(mq, store, "Q"); expect(order).toEqual(["capture", "remove"]);
  });
  it("never removes when durable capture fails", async () => {
    const { mq, store } = setup(); store.capture.mockRejectedValue(new Error("DB unavailable"));
    await expect(captureNext(mq, store, "Q")).rejects.toThrow(); expect(mq.remove).not.toHaveBeenCalled();
  });
  it("retains a durable copy after an ambiguous destructive receive", async () => {
    const { mq, store } = setup(); mq.remove.mockRejectedValue(new Error("timeout"));
    await expect(captureNext(mq, store, "Q")).rejects.toThrow(); expect(store.capture).toHaveBeenCalledOnce();
  });
  it("persists exact output before publish and completion", async () => {
    const { mq, store, order } = setup();
    await processJob(mq, store, job, async () => output, () => output);
    expect(order).toEqual(["output", "send", "finish"]);
  });
  it("a lost lease cannot publish output", async () => {
    const { mq, store } = setup(); store.output.mockResolvedValue(false);
    expect(await processJob(mq, store, job, async () => output, () => output)).toBe(false);
    expect(mq.send).not.toHaveBeenCalled();
  });
  it("retries business failure and quarantines on attempt five", async () => {
    const { mq, store } = setup(); const fail = vi.fn().mockRejectedValue(new Error("temporary"));
    expect(await processJob(mq, store, job, fail, () => output)).toBe(false);
    expect(store.retry).toHaveBeenCalledOnce(); expect(mq.send).not.toHaveBeenCalled();
    await processJob(mq, store, { ...job, attempts: 5 }, fail, () => output);
    expect(store.output).toHaveBeenCalledWith(expect.anything(), output);
  });
  it("resumes uncertain output delivery without rerunning business processing", async () => {
    const { mq, store } = setup(); mq.send.mockRejectedValueOnce(new Error("timeout")); const handle = vi.fn();
    expect(await processJob(mq, store, { ...job, state: "OUTPUT", output, output_attempts: 12 }, handle, () => output)).toBe(false);
    expect(store.retry).toHaveBeenCalled(); expect(store.finish).not.toHaveBeenCalled();
    await processJob(mq, store, { ...job, state: "OUTPUT", output }, handle, () => output);
    expect(handle).not.toHaveBeenCalled(); expect(store.finish).toHaveBeenCalled();
  });
  it("does not republish an expired summary reply", async () => {
    const { mq, store } = setup(); const expired = { ...output, expiresAt: "2000-01-01T00:00:00Z" };
    await processJob(mq, store, { ...job, state: "OUTPUT", output: expired }, vi.fn(), () => output);
    expect(mq.send).not.toHaveBeenCalled(); expect(store.finish).toHaveBeenCalled();
  });
});
