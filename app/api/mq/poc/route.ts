import { NextResponse } from "next/server";
import { createRestMq, readRestConfig } from "@/modules/ibm-mq/infrastructure/rest";
import { validSecret } from "@/modules/ibm-mq/infrastructure/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!process.env.MQ_POC_SECRET || process.env.MQ_POC_SECRET.length < 32) return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503, headers });
  if (!validSecret(request.headers.get("x-mq-poc-secret"), process.env.MQ_POC_SECRET)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try {
    const config = readRestConfig();
    const checks = [];
    for (const [role, queue] of [["consumer", config.MQ_QUEUE], ["consumer", config.MQ_SUMMARY_REQUEST_QUEUE], ["producer", config.MQ_SUMMARY_REPLY_QUEUE]] as const) {
      await createRestMq(config, role).browse(queue);
      checks.push({ role, queue, readable: true });
    }
    return NextResponse.json({ ok: true, transport: "IBM_MQ_REST_V3", checks, writePermissions: "NOT_TESTED" }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "REST_PROBE_FAILED" }, { status: 502, headers });
  }
}
