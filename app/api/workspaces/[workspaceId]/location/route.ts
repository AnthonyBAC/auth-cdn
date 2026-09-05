import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { locationInput } from "@/lib/validation/domain";
import { geocodePlace, placeLabel } from "@/lib/weather/geocoding";

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;
  const parsed = locationInput.safeParse(await request.json());
  if (!parsed.success) return apiError("BAD_REQUEST", "Location input is invalid.", parsed.error.flatten());

  const { locationName, latitude, longitude, timezone } = parsed.data;

  let resolved = { locationName, latitude, longitude, timezone };
  if (latitude === undefined || longitude === undefined || !timezone) {
    const place = await geocodePlace(locationName).catch(() => null);
    if (!place) {
      return apiError("BAD_REQUEST", "We could not find that place. Try selecting a suggestion.");
    }
    resolved = {
      locationName: placeLabel(place),
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone
    };
  }

  const { data, error } = await session.supabase
    .from("workspaces")
    .update({
      location_name: resolved.locationName,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      timezone: resolved.timezone
    })
    .eq("id", workspaceId)
    .select("id, location_name, latitude, longitude, timezone")
    .single();

  if (error) return apiError("FORBIDDEN", "Only workspace owners can update location.");
  return NextResponse.json({ workspace: data });
}
