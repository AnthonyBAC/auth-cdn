import type { CardMovedEvent } from "./events";

const WINDOW_MS = 60_000;

type BoardMetrics = {
  total: number;
  byDestinationList: Record<string, number>;
  recentMovements: number[];
};

export type MetricsState = {
  offsets: Record<number, string>;
  boards: Record<string, BoardMetrics>;
};

export function recordMovement(
  state: MetricsState,
  event: CardMovedEvent,
  partition: number,
  offset: string,
  now: number
): MetricsState {
  const previousOffset = state.offsets[partition];
  if (previousOffset !== undefined && BigInt(offset) <= BigInt(previousOffset)) return state;

  const board = state.boards[event.boardId];
  const recentMovements = (board?.recentMovements ?? []).filter((time) => time > now - WINDOW_MS);
  const occurredAt = Date.parse(event.occurredAt);
  if (occurredAt > now - WINDOW_MS && occurredAt <= now) recentMovements.push(occurredAt);

  return {
    offsets: { ...state.offsets, [partition]: offset },
    boards: {
      ...state.boards,
      [event.boardId]: {
        total: (board?.total ?? 0) + 1,
        byDestinationList: {
          ...board?.byDestinationList,
          [event.destinationListId]: (board?.byDestinationList[event.destinationListId] ?? 0) + 1
        },
        recentMovements
      }
    }
  };
}

export function summarizeMovements(state: MetricsState, now: number) {
  const boards = Object.entries(state.boards).map(([boardId, board]) => ({
    boardId,
    totalMovements: board.total,
    movementsLastMinute: board.recentMovements.filter((time) => time > now - WINDOW_MS && time <= now).length,
    byDestinationList: board.byDestinationList
  }));

  return {
    generatedAt: new Date(now).toISOString(),
    windowSeconds: WINDOW_MS / 1_000,
    totalMovements: boards.reduce((total, board) => total + board.totalMovements, 0),
    movementsLastMinute: boards.reduce((total, board) => total + board.movementsLastMinute, 0),
    boards
  };
}