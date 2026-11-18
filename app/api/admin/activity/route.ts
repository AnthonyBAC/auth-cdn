import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { isActivityAdmin } from "@/lib/auth/activity-admin";
import { requireUser } from "@/lib/auth/require-user";

export async function GET() {
  const session = await requireUser();
  if (session.error) return session.error;
  if (!isActivityAdmin(session.user)) return apiError("FORBIDDEN", "El dashboard requiere acceso administrativo.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return apiError("SERVICE_UNAVAILABLE", "Falta configurar el acceso a Supabase.");

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const pageSize = 100;
  const boards = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("boards")
      .select("id,title,workspaces!inner(archived_at),lists(id,title,position,cards(count))")
      .is("archived_at", null)
      .is("workspaces.archived_at", null)
      .is("lists.archived_at", null)
      .is("lists.cards.archived_at", null)
      .order("id")
      .order("position", { referencedTable: "lists" })
      .range(offset, offset + pageSize - 1);

    if (error) return apiError("BAD_GATEWAY", "No se pudo consultar el conteo de tarjetas.");

    for (const board of data) {
      const lists = board.lists.map((list) => ({
        id: list.id, title: list.title, count: list.cards[0]?.count ?? 0
      }));
      boards.push({
        boardId: board.id,
        title: board.title,
        totalCards: lists.reduce((total, list) => total + list.count, 0),
        lists
      });
    }
    if (data.length < pageSize) break;
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalCards: boards.reduce((total, board) => total + board.totalCards, 0),
    boards
  }, { headers: { "Cache-Control": "private, no-store" } });
}
