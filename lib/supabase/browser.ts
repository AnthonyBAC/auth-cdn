"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/supabase/config";

export function createSupabaseBrowserClient() {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  return createBrowserClient(url!, key!);
}
