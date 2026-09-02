"use client";

import { SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { getMfaState } from "@/lib/auth/mfa";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(true);
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!active) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const mfaState = await getMfaState(supabase);
      if (!active) return;

      if (!mfaState.needsChallenge) {
        router.replace(searchParams.get("redirectTo") ?? "/workspaces");
        router.refresh();
        return;
      }

      setChecking(false);
    }

    void checkSession();
    return () => {
      active = false;
    };
  }, [router, searchParams, supabase]);

  async function onSubmit(values: { code: string }) {
    setError(null);
    setPending(true);

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp.find((item) => item.status === "verified");

    if (listError || !factor) {
      setPending(false);
      setError(listError?.message ?? "No verified authenticator factor found.");
      return;
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError) {
      setPending(false);
      setError(challengeError.message);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.id,
      code: values.code
    });

    setPending(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    router.replace(searchParams.get("redirectTo") ?? "/workspaces");
    router.refresh();
  }

  if (checking) {
    return null;
  }

  return (
    <Card className="auth-card">
      <Typography.Title level={1}>Two-factor verification</Typography.Title>
      <Typography.Paragraph type="secondary">Enter the 6-digit code from your authenticator app.</Typography.Paragraph>
      <Form layout="vertical" onFinish={onSubmit} requiredMark={false}>
        <Form.Item name="code" label="Verification code" rules={[{ required: true, len: 6, message: "Enter the 6-digit code." }]}>
          <Input autoComplete="one-time-code" autoFocus inputMode="numeric" maxLength={6} placeholder="000000" />
        </Form.Item>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Button block htmlType="submit" icon={<SafetyCertificateOutlined />} loading={pending} type="primary">
          Verify
        </Button>
      </Form>
    </Card>
  );
}
