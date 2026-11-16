import type { User } from "@supabase/supabase-js";

export function isActivityAdmin(user: User | null | undefined) {
  return user?.app_metadata.activity_admin === true;
}