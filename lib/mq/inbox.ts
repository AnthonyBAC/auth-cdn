import type { MqMessage, MqTransport, Selector } from "./rest";

export type InboxJob = {
  id: string; queue_name: string; message_id: string; body: string;
  correlation_id: string | null; reply_to: string | null;
  state: "PENDING" | "OUTPUT" | "DONE"; attempts: number; output_attempts: number;
  lock_token: string; output: Output | null;
};
export type Output = { queue: string; body: string; correlationId?: string; expiresAt?: string; purpose?: "QUARANTINE" };
export interface InboxStore {
  capture(queue: string, message: MqMessage): Promise<string>;
  claim(id?: string): Promise<InboxJob | null>;
  output(job: InboxJob, output: Output): Promise<boolean>;
  finish(job: InboxJob): Promise<boolean>;
  retry(job: InboxJob): Promise<boolean>;
}

export async function captureNext(mq: MqTransport, store: InboxStore, queue: string, selector?: Selector) {
  const message = await mq.browse(queue, selector);
  if (!message) return null;
  const id = await store.capture(queue, message);
  // A crash, expiration or ambiguous DELETE cannot lose the payload: it is in Postgres.
  // Concurrent captures deduplicate on qmgr/queue/message ID before either deletion.
  await mq.remove(queue, message.id);
  return id;
}

export async function dispatchOutput(mq: MqTransport, store: InboxStore, job: InboxJob, output: Output) {
  if (output.expiresAt && Date.parse(output.expiresAt) <= Date.now()) return store.finish(job);
  await mq.send(output.queue, output.body, output);
  return store.finish(job);
}

export async function processJob(
  mq: MqTransport, store: InboxStore, job: InboxJob,
  handle: (job: InboxJob) => Promise<Output | null>,
  quarantine: (job: InboxJob) => Output,
  maxAttempts = 5
) {
  try {
    if (job.state === "OUTPUT") {
      if (!job.output) throw new Error("Salida persistida ausente.");
      return await dispatchOutput(mq, store, job, job.output);
    }
    let output: Output | null;
    try { output = await handle(job); }
    catch {
      if (job.attempts < maxAttempts) { await store.retry(job); return false; }
      output = quarantine(job);
    }
    if (!output) return store.finish(job);
    // Save the exact reply/quarantine payload before publishing it. Uncertain sends
    // can duplicate a stable result; they never cause the original payload to vanish.
    if (!await store.output(job, output)) return false;
    return await dispatchOutput(mq, store, job, output);
  } catch {
    // Output delivery retries indefinitely with capped delay; do not drop a failed BOQ send.
    await store.retry(job);
    return false;
  }
}
