import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/require-user";

export async function POST() {
  const session = await requireUser();
  if ("error" in session) return session.error;

  await session.supabase.auth.signOut();
  return new NextResponse(null, { status: 204 });
}
