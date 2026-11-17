import { describe, expect, it } from "vitest";

import type { CardMovedEvent } from "@/modules/kafka/events";
import { recordMovement, summarizeMovements, type MetricsState } from "@/modules/kafka/metrics";

const now = Date.parse("2026-11-16T16:00:00Z");
const firstBoard = "11111111-1111-4111-8111-111111111111";
const secondBoard = "22222222-2222-4222-8222-222222222222";
const firstList = "33333333-3333-4333-8333-333333333333";
const secondList = "44444444-4444-4444-8444-444444444444";

function movement(boardId: string, destinationListId: string, occurredAt = now): CardMovedEvent {
  return {
    boardId,
    destinationListId,
    occurredAt: new Date(occurredAt).toISOString(),
    eventId: "55555555-5555-4555-8555-555555555555",
    cardId: "66666666-6666-4666-8666-666666666666",
    type: "CARD_MOVED",
    schemaVersion: 1
  };
}

const empty: MetricsState = { offsets: {}, boards: {} };

describe("Kafka board metrics", () => {
  it("counts movements per board and destination as each event arrives", () => {
    let state = recordMovement(empty, movement(firstBoard, firstList), 0, "0", now);
    state = recordMovement(state, movement(firstBoard, secondList), 0, "1", now);
    state = recordMovement(state, movement(secondBoard, firstList), 0, "2", now);

    expect(summarizeMovements(state, now)).toMatchObject({
      totalMovements: 3,
      movementsLastMinute: 3,
      boards: [
        { boardId: firstBoard, totalMovements: 2, byDestinationList: { [firstList]: 1, [secondList]: 1 } },
        { boardId: secondBoard, totalMovements: 1, byDestinationList: { [firstList]: 1 } }
      ]
    });
  });

  it("expires the minute window even when no new message arrives", () => {
    let state = recordMovement(empty, movement(firstBoard, firstList, now - 60_000), 0, "0", now);
    state = recordMovement(state, movement(firstBoard, firstList, now - 1), 0, "1", now);

    expect(summarizeMovements(state, now)).toMatchObject({ totalMovements: 2, movementsLastMinute: 1 });
    expect(summarizeMovements(state, now + 60_000)).toMatchObject({ totalMovements: 2, movementsLastMinute: 0 });
  });

  it("ignores replayed offsets after reloading the saved counters", () => {
    const event = movement(firstBoard, firstList);
    const state = recordMovement(empty, event, 0, "9007199254740993", now);
    const restored: MetricsState = JSON.parse(JSON.stringify(state));

    expect(recordMovement(restored, event, 0, "9007199254740992", now)).toBe(restored);
    expect(recordMovement(restored, event, 0, "9007199254740993", now)).toBe(restored);
    const next = recordMovement(restored, event, 0, "9007199254740994", now);
    expect(summarizeMovements(next, now).totalMovements).toBe(2);
  });
});