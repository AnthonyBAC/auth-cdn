import { apiError } from "@/lib/api/errors";
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

  return { supabase, user };
}
