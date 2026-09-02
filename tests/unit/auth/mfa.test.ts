import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getMfaState } from "@/lib/auth/mfa";

type MockOptions = {
  currentLevel?: string;
  nextLevel?: string;
  totp?: { id: string; status: string }[];
  aalError?: { message: string };
  factorsError?: { message: string };
};

function mockSupabase({ currentLevel = "aal1", nextLevel = "aal1", totp = [], aalError, factorsError }: MockOptions = {}) {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: aalError ? null : { currentLevel, nextLevel, currentAuthenticationMethods: [] },
          error: aalError ?? null
        }),
        listFactors: async () => ({
          data: factorsError ? null : { all: totp, totp },
          error: factorsError ?? null
        })
      }
    }
  } as unknown as SupabaseClient;
}

describe("getMfaState", () => {
  it("does not require a challenge for users without factors", async () => {
    const state = await getMfaState(mockSupabase());

    expect(state.currentLevel).toBe("aal1");
    expect(state.hasVerifiedFactor).toBe(false);
    expect(state.needsChallenge).toBe(false);
  });

  it("requires a challenge when a verified factor exists and the session is aal1", async () => {
    const state = await getMfaState(
      mockSupabase({ currentLevel: "aal1", nextLevel: "aal2", totp: [{ id: "factor-1", status: "verified" }] })
    );

    expect(state.hasVerifiedFactor).toBe(true);
    expect(state.needsChallenge).toBe(true);
  });

  it("does not require a challenge once the session reaches aal2", async () => {
    const state = await getMfaState(
      mockSupabase({ currentLevel: "aal2", nextLevel: "aal2", totp: [{ id: "factor-1", status: "verified" }] })
    );

    expect(state.hasVerifiedFactor).toBe(true);
    expect(state.needsChallenge).toBe(false);
  });

  it("ignores unverified factors", async () => {
    const state = await getMfaState(
      mockSupabase({ currentLevel: "aal1", nextLevel: "aal1", totp: [{ id: "factor-1", status: "unverified" }] })
    );

    expect(state.hasVerifiedFactor).toBe(false);
    expect(state.needsChallenge).toBe(false);
  });

  it("throws when the AAL lookup fails", async () => {
    await expect(getMfaState(mockSupabase({ aalError: { message: "aal lookup failed" } }))).rejects.toThrow("aal lookup failed");
  });

  it("throws when listing factors fails", async () => {
    await expect(getMfaState(mockSupabase({ factorsError: { message: "factors lookup failed" } }))).rejects.toThrow(
      "factors lookup failed"
    );
  });
});
