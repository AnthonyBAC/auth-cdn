import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { locationInput } from "@/lib/validation/domain";

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;
  const parsed = locationInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Location input is invalid.", parsed.error.flatten());

  const { data, error } = await session.supabase
    .from("workspaces")
    .update({
      location_name: parsed.data.locationName,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      timezone: parsed.data.timezone
    })
    .eq("id", workspaceId)
    .select("id, location_name, latitude, longitude, timezone")
    .single();

  if (error) return apiError("FORBIDDEN", "Only workspace owners can update location.");
  return NextResponse.json({ workspace: data });
}
