import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/require-user";

export async function GET() {
  const session = await requireUser();
  if ("error" in session) return session.error;

  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.user_metadata.name ?? session.user.email?.split("@")[0]
    }
  });
}
