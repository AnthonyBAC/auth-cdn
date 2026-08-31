import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/require-user";
import { getWorkspaceContext } from "@/lib/weather/context";
import { openMeteoProvider } from "@/lib/weather/provider";

export async function GET(_: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireUser();
  if ("error" in session) return session.error;
  const { workspaceId } = await params;
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("location_name, latitude, longitude, timezone")
    .eq("id", workspaceId)
    .single();
  if (error) return apiError("NOT_FOUND", "Workspace not found.");

  const context = await getWorkspaceContext(
    workspace.location_name && workspace.latitude !== null && workspace.longitude !== null && workspace.timezone
      ? { locationName: workspace.location_name, latitude: workspace.latitude, longitude: workspace.longitude, timezone: workspace.timezone }
      : null,
    openMeteoProvider
  );

  return NextResponse.json({ context });
}
