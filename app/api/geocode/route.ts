import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { searchPlaces } from "@/lib/weather/geocoding";

export async function GET(request: Request) {
  const session = await requireUser();
  if ("error" in session) return session.error;

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") ?? "").trim();
  if (!query) return apiError("BAD_REQUEST", "Provide a search query.");
  if (query.length > 120) return apiError("BAD_REQUEST", "Search query is too long.");

  try {
    const places = await searchPlaces(query);
    return NextResponse.json({ places });
  } catch {
    return NextResponse.json({ places: [] });
  }
}
