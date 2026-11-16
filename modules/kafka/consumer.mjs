import { readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

import kafkaJs from "kafkajs";

import { CARD_EVENTS_TOPIC, cardMovedEvent } from "./events.ts";
import { recordMovement, summarizeMovements } from "./metrics.ts";

const { Kafka } = kafkaJs;
const brokers = (process.env.KAFKA_BROKERS ?? "").split(",").map((broker) => broker.trim()).filter(Boolean);
if (brokers.length === 0) throw new Error("KAFKA_BROKERS is required.");

const stateFile = process.env.KAFKA_METRICS_STATE_FILE ?? "./metrics-state.json";
let state;
try {
  state = JSON.parse(await readFile(stateFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = { offsets: {}, boards: {} };
}

const kafka = new Kafka({ clientId: "auth-cdn-board-activity", brokers });
const consumer = kafka.consumer({
  groupId: "auth-cdn-board-metrics-v1",
  sessionTimeout: 10_000,
  maxWaitTimeInMs: 1_000,
  allowAutoTopicCreation: false
});

const server = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/metrics") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(summarizeMovements(state, Date.now()), null, 2));
});

let stopping;
function stop() {
  if (!stopping) {
    server.close();
    stopping = consumer.disconnect().catch(() => { process.exitCode = 1; });
  }
  return stopping;
}

consumer.on(consumer.events.CRASH, ({ payload }) => {
  if (!payload.restart) {
    process.exitCode = 1;
    void stop();
  }
});

server.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
  void stop();
});

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await consumer.connect();
  await consumer.subscribe({ topic: CARD_EVENTS_TOPIC, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const metadata = { topic, partition, offset: message.offset };
      let value;
      try {
        value = JSON.parse(message.value?.toString("utf8") ?? "");
      } catch {
        console.warn(JSON.stringify({ ...metadata, event: "KAFKA_INVALID_CARD_EVENT" }));
        return;
      }

      const result = cardMovedEvent.safeParse(value);
      if (!result.success || message.key?.toString("utf8") !== result.data.cardId) {
        console.warn(JSON.stringify({ ...metadata, event: "KAFKA_INVALID_CARD_EVENT" }));
        return;
      }

      const next = recordMovement(state, result.data, partition, message.offset, Date.now());
      if (next === state) return;

      // Save the counters and offset together before Kafka can commit this message.
      const pendingFile = stateFile + ".tmp";
      await writeFile(pendingFile, JSON.stringify(next));
      await rename(pendingFile, stateFile);
      state = next;
      console.log(JSON.stringify({ ...metadata, ...result.data }));
    }
  });
  if (!stopping) server.listen(9102, "0.0.0.0");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await stop();
}