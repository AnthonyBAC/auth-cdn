// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { crearResumenStore } from "../../infrastructure/tablero";

type Fixture = {
  board?: unknown;
  boardError?: unknown;
  membership?: unknown;
  membershipError?: unknown;
  lists?: Array<{ id: string }>;
  listsError?: unknown;
  cards?: Array<{ list_id: string; completed_at: string | null; due_at: string | null }>;
  cardsError?: unknown;
};

function supabaseFalso(fixture: Fixture) {
  const consultas: string[] = [];

  function query(table: string) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        consultas.push(`${table}:maybeSingle`);
        if (table === "boards") return { data: fixture.board ?? null, error: fixture.boardError ?? null };
        if (table === "memberships") return { data: fixture.membership ?? null, error: fixture.membershipError ?? null };
        return { data: null, error: null };
      }),
      then(resolve: (value: unknown) => unknown) {
        consultas.push(`${table}:list`);
        if (table === "lists") return Promise.resolve({ data: fixture.lists ?? [], error: fixture.listsError ?? null }).then(resolve);
        if (table === "cards") return Promise.resolve({ data: fixture.cards ?? [], error: fixture.cardsError ?? null }).then(resolve);
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
    };
    return builder;
  }

  return {
    consultas,
    client: { from: vi.fn((table: string) => query(table)) } as unknown as SupabaseClient
  };
}

const boardId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

describe("Consulta de resumen en Supabase", () => {
  it("rechaza un tablero archivado sin consultar membresía", async () => {
    const { client, consultas } = supabaseFalso({
      board: {
        id: boardId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        archived_at: "2026-10-19T00:00:00.000Z",
        workspaces: { archived_at: null }
      }
    });

    await expect(crearResumenStore(client).consultar(boardId, userId)).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND"
    });
    expect(consultas).toEqual(["boards:maybeSingle"]);
  });

  it("rechaza un workspace archivado", async () => {
    const { client } = supabaseFalso({
      board: {
        id: boardId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        archived_at: null,
        workspaces: { archived_at: "2026-10-19T00:00:00.000Z" }
      }
    });

    await expect(crearResumenStore(client).consultar(boardId, userId)).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND"
    });
  });

  it("rechaza a un usuario sin membresía activa", async () => {
    const { client } = supabaseFalso({
      board: {
        id: boardId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        archived_at: null,
        workspaces: { archived_at: null }
      },
      membership: null
    });

    await expect(crearResumenStore(client).consultar(boardId, userId)).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN"
    });
  });

  it("excluye tarjetas de listas archivadas", async () => {
    const { client } = supabaseFalso({
      board: {
        id: boardId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        archived_at: null,
        workspaces: { archived_at: null }
      },
      membership: { role: "viewer" },
      lists: [{ id: "lista-activa" }],
      cards: [
        { list_id: "lista-activa", completed_at: null, due_at: null },
        { list_id: "lista-archivada", completed_at: null, due_at: null }
      ]
    });

    await expect(crearResumenStore(client).consultar(boardId, userId)).resolves.toEqual({
      ok: true,
      cards: [{ completedAt: null, dueAt: null }]
    });
  });

  it("propaga fallos transitorios de Supabase", async () => {
    const { client } = supabaseFalso({
      board: {
        id: boardId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        archived_at: null,
        workspaces: { archived_at: null }
      },
      membershipError: new Error("red")
    });

    await expect(crearResumenStore(client).consultar(boardId, userId)).rejects.toThrow(
      "No se pudo verificar la membresía."
    );
  });
});
