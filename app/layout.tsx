import type { Metadata } from "next";
import Link from "next/link";

import { isActivityAdmin } from "@/lib/auth/activity-admin";
import { Providers } from "@/app/providers";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "./globals.css";
import "antd/dist/reset.css";

export const metadata: Metadata = {
  title: "Auth DCN",
  description: "Supabase-backed Trello-style MVP"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { isConfigured } = getSupabaseConfig();
  const user = isConfigured
    ? await createSupabaseServerClient()
        .then((supabase) => supabase.auth.getUser())
        .then(({ data }) => data.user)
        .catch(() => null)
    : null;

  return (
    <html lang="en">
      <body>
        <Providers>
          <main className="shell">
            <header className="topbar">
              <Link className="brand" href={user ? "/workspaces" : "/login"}>
                Auth DCN
              </Link>
              {user ? (
                <nav className="toolbar" aria-label="Primary">
                  <Link href="/workspaces">Workspaces</Link>
                  <Link href="/notifications">Avisos</Link>
                  {isActivityAdmin(user) ? (
                    <>
                      <Link href="/admin/activity">Dashboard</Link>
                      <Link href="/diagnostics/supabase">Supabase</Link>
                    </>
                  ) : null}
                </nav>
              ) : null}
            </header>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
