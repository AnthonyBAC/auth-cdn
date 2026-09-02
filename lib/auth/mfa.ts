import type { SupabaseClient } from "@supabase/supabase-js";

export type MfaState = {
  /** Current authenticator assurance level of the session (aal1 | aal2). */
  currentLevel: "aal1" | "aal2";
  /** Assurance level the session would reach after completing the next factor. */
  nextLevel: "aal1" | "aal2";
  /** True when the user has at least one verified TOTP factor. */
  hasVerifiedFactor: boolean;
  /** True when the user has a verified factor but the session is still aal1 (must complete the TOTP challenge). */
  needsChallenge: boolean;
};

/**
 * Reads the session AAL plus the user's verified factors and derives the MFA state.
 * A user that enrolled and verified TOTP must complete the challenge after each
 * password sign-in (session starts at aal1) before reaching protected areas.
 */
export async function getMfaState(supabase: SupabaseClient): Promise<MfaState> {
  const [{ data: aal, error: aalError }, { data: factors, error: factorsError }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors()
  ]);

  if (aalError) throw new Error(aalError.message);
  if (factorsError) throw new Error(factorsError.message);

  const currentLevel = (aal?.currentLevel ?? "aal1") as MfaState["currentLevel"];
  const nextLevel = (aal?.nextLevel ?? "aal1") as MfaState["nextLevel"];
  const hasVerifiedFactor = (factors?.totp ?? []).some((factor) => factor.status === "verified");
  const needsChallenge = hasVerifiedFactor && currentLevel === "aal1" && nextLevel === "aal2";

  return { currentLevel, nextLevel, hasVerifiedFactor, needsChallenge };
}
