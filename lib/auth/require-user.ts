import { apiError } from "@/lib/api/errors";
import { getMfaState } from "@/lib/auth/mfa";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: apiError("UNAUTHENTICATED", "Sign in to continue.") };
  }

  const mfaState = await getMfaState(supabase);
  if (mfaState.needsChallenge) {
    return { error: apiError("FORBIDDEN", "Complete the two-factor challenge to continue.", { aal: mfaState.currentLevel }) };
  }

  return { supabase, user };
}
