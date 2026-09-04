import { NextResponse } from "next/server";

import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) {
    return NextResponse.json(
      {
        ok: false,
        auth: { ok: false, signedIn: false, userId: null },
        database: { ok: false, rlsReadable: false, sampleRows: 0, error: { message: "Supabase environment variables are missing." } },
        latencyMs: 0,
        projectUrlConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        publishableKeyConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      },
      { status: 503 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const startedAt = Date.now();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  const authClientOk = !userError || userError.name === "AuthSessionMissingError";

  const { data, error } = await supabase.from("workspaces").select("id").limit(1);

  return NextResponse.json({
    ok: !error,
    auth: {
      ok: authClientOk,
      signedIn: Boolean(user),
      userId: user?.id ?? null
    },
    database: {
      ok: !error,
      rlsReadable: !error,
      sampleRows: data?.length ?? 0,
      error: error ? { code: error.code, message: error.message } : null
    },
    latencyMs: Date.now() - startedAt,
    projectUrlConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKeyConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  });
}
