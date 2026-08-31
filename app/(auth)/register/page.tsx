import Link from "next/link";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-forms";

export default function RegisterPage() {
  return (
    <>
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
      <p className="muted" style={{ textAlign: "center" }}>
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
