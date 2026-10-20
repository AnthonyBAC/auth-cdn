import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { apiError } from "@/lib/api/errors";

export async function PATCH(_: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { notificationId } = await params;
  if (!z.string().uuid().safeParse(notificationId).success) return apiError("BAD_REQUEST", "Invalid notification id.");
  const { data, error } = await session.supabase.from("notifications")
    .update({ read_at: new Date().toISOString() }).eq("id", notificationId).eq("user_id", session.user.id)
    .select("id,read_at").maybeSingle();
  if (error) return apiError("INTERNAL_ERROR", "Could not update notification.");
  if (!data) return apiError("NOT_FOUND", "Notification not found.");
  return NextResponse.json({ notification: data });
}
