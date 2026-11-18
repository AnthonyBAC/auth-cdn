import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  is: vi.fn(),
  order: vi.fn(),
  range: vi.fn()
}));

vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { GET } from "@/app/api/admin/activity/route";

const boardId = "22222222-2222-4222-8222-222222222222";
const pendingList = "33333333-3333-4333-8333-333333333333";
const progressList = "44444444-4444-4444-8444-444444444444";

function board(pending: number, progress: number) {
  return {
    id: boardId,
    title: "Proyecto semestral",
    lists: [
      { id: pendingList, title: "Por hacer", cards: [{ count: pending }] },
      { id: progressList, title: "En curso", cards: [{ count: progress }] },
      { id: "55555555-5555-4555-8555-555555555555", title: "Hecho", cards: [] }
    ]
  };
}

describe("Current card dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    vi.stubEnv("KAFKA_ENABLED", "false");
    vi.stubEnv("KAFKA_METRICS_TOKEN", undefined);
    mocks.requireUser.mockResolvedValue({ user: { app_metadata: { activity_admin: true } } });
    mocks.createClient.mockReturnValue({ from: mocks.from });
    const query = { select: mocks.select, is: mocks.is, order: mocks.order, range: mocks.range };
    mocks.from.mockReturnValue(query);
    mocks.select.mockReturnValue(query);
    mocks.is.mockReturnValue(query);
    mocks.order.mockReturnValue(query);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("counts current cards after a move without requiring Kafka or its metrics token", async () => {
    mocks.range.mockResolvedValueOnce({ data: [board(1, 1)], error: null });
    const before = await GET();
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({
      totalCards: 2,
      boards: [{ totalCards: 2, lists: [
        { title: "Por hacer", count: 1 },
        { title: "En curso", count: 1 },
        { title: "Hecho", count: 0 }
      ] }]
    });

    mocks.range.mockResolvedValueOnce({ data: [board(0, 2)], error: null });
    const after = await GET();
    expect(after.headers.get("cache-control")).toBe("private, no-store");
    expect(await after.json()).toMatchObject({
      totalCards: 2,
      boards: [{ totalCards: 2, lists: [
        { title: "Por hacer", count: 0 },
        { title: "En curso", count: 2 },
        { title: "Hecho", count: 0 }
      ] }]
    });
    for (const path of ["archived_at", "workspaces.archived_at", "lists.archived_at", "lists.cards.archived_at"]) {
      expect(mocks.is).toHaveBeenCalledWith(path, null);
    }
  });

  it("restricts the global count to administrators before opening a privileged connection", async () => {
    mocks.requireUser.mockResolvedValue({ user: { app_metadata: {} } });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("includes boards beyond the first page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: String(index), title: String(index), lists: [] }));
    mocks.range.mockResolvedValueOnce({ data: firstPage, error: null });
    mocks.range.mockResolvedValueOnce({ data: [board(1, 1)], error: null });

    const response = await GET();
    const snapshot = await response.json();

    expect(snapshot.totalCards).toBe(2);
    expect(snapshot.boards).toHaveLength(101);
    expect(mocks.range.mock.calls).toEqual([[0, 99], [100, 199]]);
  });
});
