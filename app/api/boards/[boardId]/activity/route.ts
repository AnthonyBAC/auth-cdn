import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";

const movementCount = z.number().int().nonnegative();
const metricsSchema = z.object({
  generatedAt: z.string().datetime(),
  boards: z.array(z.object({
    boardId: z.string().uuid(),
    totalMovements: movementCount,
    movementsLastMinute: movementCount,
    byDestinationList: z.record(z.string().uuid(), movementCount)
  }))
});

export async function GET(_: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  if (process.env.KAFKA_ENABLED !== "true") return apiError("NOT_FOUND", "La actividad en tiempo real está desactivada.");

  const { boardId } = await params;
  if (!z.string().uuid().safeParse(boardId).success) return apiError("BAD_REQUEST", "El tablero no es válido.");

  // Read through the user's session so workspace RLS also protects the metrics.
  const { data: board, error } = await session.supabase
    .from("boards")
    .select("id, workspaces!inner(archived_at)")
    .eq("id", boardId)
    .is("archived_at", null)
    .is("workspaces.archived_at", null)
    .maybeSingle();

  if (error) return apiError("INTERNAL_ERROR", "No se pudo comprobar el acceso al tablero.");
  if (!board) return apiError("NOT_FOUND", "No tienes acceso a este tablero.");

  try {
    const response = await fetch(process.env.KAFKA_METRICS_URL || "http://127.0.0.1:9102/metrics", {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500)
    });
    if (!response.ok) return apiError("BAD_GATEWAY", "Las métricas no están disponibles.");

    const metrics = metricsSchema.parse(await response.json());
    const activity = metrics.boards.find((entry) => entry.boardId === board.id);

    return NextResponse.json({
      generatedAt: metrics.generatedAt,
      totalMovements: activity?.totalMovements ?? 0,
      movementsLastMinute: activity?.movementsLastMinute ?? 0,
      byDestinationList: activity?.byDestinationList ?? {}
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return apiError("BAD_GATEWAY", "Las métricas no están disponibles.");
  }
}