import Link from "next/link";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-forms";

export default function LoginPage() {
  return (
    <>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
      <p className="muted" style={{ textAlign: "center" }}>
        New here? <Link href="/register">Create an account</Link>
      </p>
    </>
  );
}
