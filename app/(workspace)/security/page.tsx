import Link from "next/link";
import { redirect } from "next/navigation";

import { MfaEnrollment } from "@/components/auth/mfa-enrollment";
import { getMfaState } from "@/lib/auth/mfa";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SecurityPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const mfaState = await getMfaState(supabase);

  // Keep the profile flag in sync with the actual verified factors in
  // Supabase Auth (the source of truth), in case it drifted.
  const { data: profile } = await supabase.from("profiles").select("totp_enabled").eq("id", user.id).single();
  if (profile && profile.totp_enabled !== mfaState.hasVerifiedFactor) {
    await supabase
      .from("profiles")
      .update(
        mfaState.hasVerifiedFactor
          ? { totp_enabled: true }
          : { totp_enabled: false, totp_recovery_code_hash: null }
      )
      .eq("id", user.id);
  }

  return (
    <section className="grid">
      <div className="toolbar">
        <h1 style={{ flex: 1, margin: 0 }}>Security</h1>
        <Link className="button secondary" href="/workspaces">
          Back
        </Link>
      </div>
      <MfaEnrollment enabled={mfaState.hasVerifiedFactor} />
    </section>
  );
}
