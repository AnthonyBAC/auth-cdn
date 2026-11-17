import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { apiError } from "@/lib/api/errors";

export async function GET() {
  const session = await requireUser();
  if ("error" in session) return session.error;
  // Use the user's session/RLS, never service_role, when delivering notifications.
  const { data, error } = await session.supabase.from("notifications")
    .select("id,card_id,message,created_at,read_at")
    .eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(100);
  if (error) return apiError("INTERNAL_ERROR", "Could not load notifications.");
  return NextResponse.json({ notifications: data }, { headers: { "Cache-Control": "no-store" } });
}
