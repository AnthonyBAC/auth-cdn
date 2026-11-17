import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { ErrorPuenteResumen, solicitarResumenRemoto } from "@/modules/ibm-mq/application/resumen-cliente";

export const runtime = "nodejs";
export const maxDuration = 60;

type BoardRow = {
  id: string;
  workspace_id: string;
  archived_at: string | null;
  workspaces: { archived_at: string | null } | { archived_at: string | null }[] | null;
};

function workspaceArchived(value: BoardRow["workspaces"]): boolean {
  const workspace = Array.isArray(value) ? value[0] : value;
  return !workspace || workspace.archived_at !== null;
}

export async function POST(_: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;

  const { boardId } = await params;
  if (!z.string().uuid().safeParse(boardId).success) {
    return apiError("BAD_REQUEST", "Board id is invalid.");
  }

  const { data: boardData, error: boardError } = await session.supabase
    .from("boards")
    .select("id, workspace_id, archived_at, workspaces!inner(archived_at)")
    .eq("id", boardId)
    .maybeSingle();

  if (boardError) return apiError("INTERNAL_ERROR", "Could not load the board.");

  const board = boardData as unknown as BoardRow | null;
  if (!board || board.archived_at !== null || workspaceArchived(board.workspaces)) {
    return apiError("NOT_FOUND", "Board not found.");
  }

  const { data: membership, error: membershipError } = await session.supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", board.workspace_id)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) return apiError("INTERNAL_ERROR", "Could not verify workspace access.");
  if (!membership) return apiError("FORBIDDEN", "You do not have access to this board.");

  let reply: Awaited<ReturnType<typeof solicitarResumenRemoto>>;
  try {
    reply = await solicitarResumenRemoto({ boardId, userId: session.user.id });
  } catch (error) {
    if (error instanceof ErrorPuenteResumen) {
      if (error.status === 504) return apiError("GATEWAY_TIMEOUT", error.message, { code: error.code });
      if (error.status === 503) return apiError("SERVICE_UNAVAILABLE", error.message, { code: error.code });
      return apiError("BAD_GATEWAY", error.message, { code: error.code });
    }
    return apiError("BAD_GATEWAY", "The summary service failed.");
  }

  if (reply.boardId !== boardId) {
    return apiError("BAD_GATEWAY", "The summary response does not match the requested board.");
  }

  if (reply.status === "ERROR") {
    const code = reply.error?.code ?? "INTERNAL_ERROR";
    const message = reply.error?.message ?? "The summary could not be calculated.";
    if (code === "FORBIDDEN") return apiError("FORBIDDEN", message, { code });
    if (code === "NOT_FOUND") return apiError("NOT_FOUND", message, { code });
    if (code === "EXPIRED") return apiError("GATEWAY_TIMEOUT", message, { code });
    return apiError("BAD_GATEWAY", message, { code });
  }

  if (!reply.stats) {
    return apiError("BAD_GATEWAY", "The summary response has no statistics.");
  }

  return NextResponse.json({
    summary: reply.stats,
    requestId: reply.requestId,
    generatedAt: reply.generatedAt
  });
}
