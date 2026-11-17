import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const broker = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn()
}));

vi.mock("kafkajs", () => ({
  Kafka: class {
    producer() {
      return broker;
    }
  },
  logLevel: { NOTHING: 0 }
}));

const movement = {
  cardId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
  destinationListId: "33333333-3333-4333-8333-333333333333"
};

describe("Kafka card activity producer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("KAFKA_ENABLED", "true");
    vi.stubEnv("KAFKA_BROKERS", "127.0.0.1:9092");
    broker.connect.mockResolvedValue(undefined);
    broker.disconnect.mockResolvedValue(undefined);
    broker.send.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("leaves Kafka disabled by default", async () => {
    vi.stubEnv("KAFKA_ENABLED", undefined);
    const { publishCardMoved } = await import("@/modules/kafka/producer");

    await publishCardMoved(movement);

    expect(broker.connect).not.toHaveBeenCalled();
  });

  it("shares the connection and publishes keyed, versioned events", async () => {
    const { publishCardMoved } = await import("@/modules/kafka/producer");
    const { CARD_EVENTS_TOPIC, cardMovedEvent } = await import("@/modules/kafka/events");

    await Promise.all([publishCardMoved(movement), publishCardMoved(movement)]);

    expect(broker.connect).toHaveBeenCalledTimes(1);
    expect(broker.send).toHaveBeenCalledTimes(2);
    const [first, second] = broker.send.mock.calls.map(([record]) => {
      expect(record.topic).toBe(CARD_EVENTS_TOPIC);
      expect(record.messages[0].key).toBe(movement.cardId);
      const event = cardMovedEvent.parse(JSON.parse(record.messages[0].value));
      expect(event).toMatchObject({ ...movement, schemaVersion: 1, type: "CARD_MOVED" });
      return event.eventId;
    });
    expect(first).not.toBe(second);
  });

  it("allows a subsequent movement to connect after an initial broker failure", async () => {
    broker.connect.mockRejectedValueOnce(new Error("Broker unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { publishCardMoved } = await import("@/modules/kafka/producer");

    await publishCardMoved(movement);
    expect(broker.send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("KAFKA_CARD_PUBLISH_FAILED"));

    await publishCardMoved(movement);
    expect(broker.connect).toHaveBeenCalledTimes(2);
    expect(broker.send).toHaveBeenCalledTimes(1);
  });

  it("stops waiting after two seconds when a send remains pending", async () => {
    vi.useFakeTimers();
    broker.send.mockReturnValue(new Promise(() => undefined));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { publishCardMoved } = await import("@/modules/kafka/producer");

    const publication = publishCardMoved(movement);
    await vi.advanceTimersByTimeAsync(2_000);
    await publication;

    expect(broker.send).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("KAFKA_CARD_PUBLISH_FAILED"));
  });
});
