// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const db = new PGlite();
const id = `ID:${"A".repeat(48)}`;
async function capture(body = "payload") {
  return (await db.query<{ id: string }>("select mq_rest_capture('QM','Q',$1,$2,null,null) as id", [id, body])).rows[0].id;
}
async function claim(key: string | null = null) {
  return (await db.query<{ job: { id: string; lock_token: string; state: string; attempts: number; output_attempts: number; output: unknown } | null }>("select mq_rest_claim('QM',$1) as job", [key])).rows[0].job;
}
async function update(key: string, token: string, action: string, output: unknown = null) {
  return (await db.query<{ result: boolean }>("select mq_rest_update($1,$2,$3,$4::jsonb) as result", [key, token, action, JSON.stringify(output)])).rows[0].result;
}
beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;");
  await db.exec(await readFile(new URL("../../../../supabase/migrations/0009_mq_rest_inbox.sql", import.meta.url), "utf8"));
}, 30000);
beforeEach(async () => { await db.exec("reset role; truncate mq_rest_inbox"); });
afterAll(async () => db.close());

describe("REST inbox persistence, leases and access", () => {
  it("deduplicates captures, including after completion", async () => {
    const key = await capture(); expect(await capture()).toBe(key);
    const job = (await claim())!; await update(key, job.lock_token, "DONE");
    expect(await capture()).toBe(key); expect(await claim()).toBeNull();
  });
  it("rejects an update without a live reservation token", async () => {
    const key = await capture();
    expect((await db.query<{ result: boolean }>("select mq_rest_update($1,null,'DONE') as result", [key])).rows[0].result).toBe(false);
    expect((await claim())!.state).toBe("PENDING");
  });
  it("rejects a reused message ID with a different body", async () => {
    await capture(); await expect(capture("different")).rejects.toThrow("MQ_MESSAGE_ID_COLLISION");
  });
  it("excludes held leases and recovers an expired lease with a new token", async () => {
    await capture(); const first = (await claim())!; expect(await claim()).toBeNull();
    await db.query("update mq_rest_inbox set locked_until=now()-interval '1 second'");
    const second = (await claim())!;
    expect(second.lock_token).not.toBe(first.lock_token); expect(second.attempts).toBe(2);
    expect(await update(first.id, first.lock_token, "DONE")).toBe(false);
    expect(await update(second.id, second.lock_token, "DONE")).toBe(true);
  });
  it("persists output across crashes without recalculating business state", async () => {
    await capture(); const first = (await claim())!;
    const output = { queue: "BOQ", body: "stable-result" };
    expect(await update(first.id, first.lock_token, "OUTPUT", output)).toBe(true);
    await db.query("update mq_rest_inbox set locked_until=now()-interval '1 second'");
    const second = (await claim())!;
    expect(second.state).toBe("OUTPUT"); expect(second.attempts).toBe(1);
    expect(second.output_attempts).toBe(2); expect(second.output).toEqual(output);
  });
  it("enforces retry delay and preserves payload after arbitrarily many output failures", async () => {
    await capture(); const first = (await claim())!;
    await update(first.id, first.lock_token, "OUTPUT", { queue: "BOQ", body: "stable" });
    await update(first.id, first.lock_token, "RETRY"); expect(await claim()).toBeNull();
    await db.query("update mq_rest_inbox set next_attempt_at=now()-interval '1 second',output_attempts=1000");
    const next = (await claim())!; await update(next.id, next.lock_token, "RETRY");
    const row = (await db.query<{ delay: number; body: string }>("select extract(epoch from next_attempt_at-now()) as delay,body from mq_rest_inbox")).rows[0];
    expect(Number(row.delay)).toBeGreaterThan(290); expect(Number(row.delay)).toBeLessThanOrEqual(300); expect(row.body).toBe("payload");
  });
  it.each(["anon", "authenticated"])("blocks %s from payloads and worker functions", async (role) => {
    await capture(); await db.exec(`set role ${role}`);
    await expect(db.query("select * from mq_rest_inbox")).rejects.toThrow("permission denied");
    await expect(db.query("select mq_rest_claim('QM')")).rejects.toThrow("permission denied");
    await db.exec("reset role");
  });
  it("allows only service_role to capture and lease for a specific qmgr", async () => {
    await db.exec("set role service_role"); const key = await capture();
    expect((await claim(key))!.id).toBe(key);
    expect((await db.query<{ job: unknown }>("select mq_rest_claim('OTHER') as job")).rows[0].job).toBeNull();
  });
});
