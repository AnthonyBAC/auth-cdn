import { Suspense } from "react";

import { MfaChallengeForm } from "@/components/auth/mfa-challenge-form";

export default function MfaChallengePage() {
  return (
    <Suspense>
      <MfaChallengeForm />
    </Suspense>
  );
}
