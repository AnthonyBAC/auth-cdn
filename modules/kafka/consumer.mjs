import kafkaJs from "kafkajs";

import { CARD_EVENTS_TOPIC, cardMovedEvent } from "./events.ts";

const { Kafka } = kafkaJs;
const brokers = (process.env.KAFKA_BROKERS ?? "").split(",").map((broker) => broker.trim()).filter(Boolean);
if (brokers.length === 0) throw new Error("KAFKA_BROKERS is required.");

const kafka = new Kafka({ clientId: "auth-cdn-board-activity", brokers });
const consumer = kafka.consumer({
  groupId: "auth-cdn-board-activity-demo",
  allowAutoTopicCreation: false
});

consumer.on(consumer.events.CRASH, ({ payload }) => {
  if (!payload.restart) process.exitCode = 1;
});

async function stop() {
  try {
    await consumer.disconnect();
  } catch {
    process.exitCode = 1;
  }
}

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

      console.log(JSON.stringify({ ...metadata, ...result.data }));
    }
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await stop();
}
