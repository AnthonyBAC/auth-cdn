import type { SupabaseClient } from "@supabase/supabase-js";

import type { TarjetaResumen } from "../domain/resumen";

export type ConsultaResumen =
  | { ok: true; cards: TarjetaResumen[] }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" };

export interface ResumenStore {
  consultar(boardId: string, userId: string): Promise<ConsultaResumen>;
}

type BoardRow = {
  id: string;
  workspace_id: string;
  archived_at: string | null;
  workspaces: { archived_at: string | null } | { archived_at: string | null }[] | null;
};

type CardRow = {
  completed_at: string | null;
  due_at: string | null;
  list_id: string;
};

function workspaceArchived(value: BoardRow["workspaces"]): boolean | null {
  const workspace = Array.isArray(value) ? value[0] : value;
  if (!workspace) return null;
  return workspace.archived_at !== null;
}

// Acceso con credenciales de servidor. No se confía en boardId/userId del
// mensaje: la membresía y el estado del tablero se comprueban de nuevo.
export function crearResumenStore(supabase: SupabaseClient): ResumenStore {
  return {
    async consultar(boardId, userId) {
      const { data: boardData, error: boardError } = await supabase
        .from("boards")
        .select("id, workspace_id, archived_at, workspaces!inner(archived_at)")
        .eq("id", boardId)
        .maybeSingle();

      if (boardError) throw new Error("No se pudo consultar el tablero.");

      const board = boardData as unknown as BoardRow | null;
      if (!board || board.archived_at !== null) {
        return { ok: false, code: "NOT_FOUND" };
      }

      const archived = workspaceArchived(board.workspaces);
      if (archived === null || archived) {
        return { ok: false, code: "NOT_FOUND" };
      }

      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("role")
        .eq("workspace_id", board.workspace_id)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();

      if (membershipError) throw new Error("No se pudo verificar la membresía.");
      if (!membership) return { ok: false, code: "FORBIDDEN" };

      const { data: lists, error: listsError } = await supabase
        .from("lists")
        .select("id")
        .eq("board_id", boardId)
        .is("archived_at", null);

      if (listsError) throw new Error("No se pudieron consultar las listas.");

      const activeLists = new Set((lists ?? []).map((list) => list.id));
      if (activeLists.size === 0) return { ok: true, cards: [] };

      const { data: cards, error: cardsError } = await supabase
        .from("cards")
        .select("list_id, completed_at, due_at")
        .eq("board_id", boardId)
        .is("archived_at", null);

      if (cardsError) throw new Error("No se pudieron consultar las tarjetas.");

      return {
        ok: true,
        cards: ((cards ?? []) as CardRow[])
          .filter((card) => activeLists.has(card.list_id))
          .map((card) => ({ completedAt: card.completed_at, dueAt: card.due_at }))
      };
    }
  };
}
