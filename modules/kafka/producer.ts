import { randomUUID } from "node:crypto";

import { Kafka, logLevel, type Producer } from "kafkajs";

import { CARD_EVENTS_TOPIC, cardMovedEvent, type CardMovedEvent } from "./events";

type CardMovement = Pick<CardMovedEvent, "cardId" | "boardId" | "destinationListId">;

let connection: Promise<Producer> | undefined;

function getProducer() {
  if (!connection) {
    const brokers = (process.env.KAFKA_BROKERS ?? "").split(",").map((broker) => broker.trim()).filter(Boolean);
    if (brokers.length === 0) throw new Error("KAFKA_BROKERS is required when Kafka is enabled.");

    const kafka = new Kafka({
      clientId: "auth-cdn",
      brokers,
      connectionTimeout: 500,
      requestTimeout: 750,
      retry: { retries: 0 },
      logLevel: logLevel.NOTHING
    });
    const producer = kafka.producer({ allowAutoTopicCreation: false });

    connection = producer.connect().then(() => producer).catch(async (error: unknown) => {
      connection = undefined;
      await producer.disconnect().catch(() => undefined);
      throw error;
    });
  }

  return connection;
}

export async function publishCardMoved(movement: CardMovement) {
  if (process.env.KAFKA_ENABLED !== "true") return;

  const eventId = randomUUID();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const event = cardMovedEvent.parse({
      ...movement,
      eventId,
      schemaVersion: 1,
      type: "CARD_MOVED",
      occurredAt: new Date().toISOString()
    });
    const publish = getProducer().then((producer) => producer.send({
      topic: CARD_EVENTS_TOPIC,
      acks: -1,
      timeout: 750,
      messages: [{ key: event.cardId, value: JSON.stringify(event) }]
    }));
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Kafka publication timed out.")), 2_000);
    });

    await Promise.race([publish, deadline]);
  } catch (error) {
    console.error(JSON.stringify({
      event: "KAFKA_CARD_PUBLISH_FAILED",
      eventId,
      cardId: movement.cardId,
      error: error instanceof Error ? error.name : "UnknownError"
    }));
  } finally {
    clearTimeout(timeout);
  }
}
