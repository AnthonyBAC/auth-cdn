import { NextResponse } from "next/server";
import { createCloudMq } from "@/lib/mq/cloud";
import { validSecret } from "@/lib/mq/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!process.env.MQ_CRON_SECRET || process.env.MQ_CRON_SECRET.length < 32) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503, headers });
  }
  if (!validSecret(request.headers.get("authorization"), `Bearer ${process.env.MQ_CRON_SECRET}`)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  }
  try {
    const stats = await createCloudMq().tick();
    if (stats.errors) console.error(JSON.stringify({ event: "MQ_REST_CYCLE_ERRORS", errors: stats.errors }));
    return NextResponse.json(stats, { status: stats.errors ? 502 : 200, headers });
  } catch {
    return NextResponse.json({ error: "MQ_CYCLE_FAILED" }, { status: 502, headers });
  }
}
