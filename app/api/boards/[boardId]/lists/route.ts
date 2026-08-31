import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { listInput } from "@/lib/validation/domain";

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { boardId } = await params;
  const parsed = listInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "List input is invalid.", parsed.error.flatten());

  const { count } = await session.supabase.from("lists").select("*", { count: "exact", head: true }).eq("board_id", boardId);
  const { data, error } = await session.supabase
    .from("lists")
    .insert({ board_id: boardId, title: parsed.data.title, position: parsed.data.position ?? count ?? 0 })
    .select("id, title, position")
    .single();
  if (error) return apiError("FORBIDDEN", "You do not have permission to create lists.");
  return NextResponse.json({ list: data }, { status: 201 });
}
