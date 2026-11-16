import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/errors";
import { isActivityAdmin } from "@/lib/auth/activity-admin";
import { requireUser } from "@/lib/auth/require-user";

const movementCount = z.number().int().nonnegative();
const totals = { totalMovements: movementCount, movementsLastMinute: movementCount };
const metricsSchema = z.object({
  generatedAt: z.string().datetime(),
  ...totals,
  boards: z.array(z.object({
    boardId: z.string().uuid(),
    ...totals,
    byDestinationList: z.record(z.string().uuid(), movementCount)
  }))
});

function batches(ids: string[]) {
  return Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, (index + 1) * 100));
}

export async function GET() {
  const session = await requireUser();
  if (session.error) return session.error;
  if (!isActivityAdmin(session.user)) return apiError("FORBIDDEN", "El dashboard requiere acceso administrativo.");

  const token = process.env.KAFKA_METRICS_TOKEN;
  if (process.env.KAFKA_ENABLED !== "true" || !token || token.length < 32) {
    return apiError("SERVICE_UNAVAILABLE", "Las métricas de Kafka no están configuradas.");
  }

  try {
    const response = await fetch(process.env.KAFKA_METRICS_URL || "http://127.0.0.1:9102/metrics", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1_500)
    });
    if (!response.ok) return apiError("BAD_GATEWAY", "Las métricas no están disponibles.");

    const snapshot = metricsSchema.parse(await response.json());
    // Resolve display names across workspaces only after verifying the administrative role.
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const boardIds = snapshot.boards.map((board) => board.boardId);
    const listIds = [...new Set(snapshot.boards.flatMap((board) => Object.keys(board.byDestinationList)))];
    const [boards, lists] = await Promise.all([
      Promise.all(batches(boardIds).map((ids) => db.from("boards").select("id,title").in("id", ids))),
      Promise.all(batches(listIds).map((ids) => db.from("lists").select("id,title,board_id").in("id", ids)))
    ]);
    if ([...boards, ...lists].some((entry) => entry.error)) {
      return apiError("BAD_GATEWAY", "No se pudieron consultar los nombres de los tableros y listas.");
    }

    const boardNames = new Map(boards.flatMap(({ data }) => (data ?? []).map((board) => [board.id, board.title])));
    const listNames = new Map(lists.flatMap(({ data }) => (data ?? []).map((list) => [list.id, list])));
    return NextResponse.json({
      ...snapshot,
      boards: snapshot.boards.map(({ boardId, byDestinationList, ...activity }) => ({
        ...activity,
        boardId,
        title: boardNames.get(boardId) ?? "Tablero histórico",
        lists: Object.entries(byDestinationList).map(([id, count]) => {
          const list = listNames.get(id);
          return { id, count, title: list?.board_id === boardId ? list.title : "Lista histórica" };
        })
      }))
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return apiError("BAD_GATEWAY", "Las métricas no están disponibles.");
  }
}