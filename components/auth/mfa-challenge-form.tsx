"use client";

import { KeyOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { getMfaState } from "@/lib/auth/mfa";
import { hashToken } from "@/lib/auth/tokens";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(true);
  const [useRecovery, setUseRecovery] = useState(false);
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

  async function onRecoverySubmit(values: { recoveryCode: string }) {
    setError(null);
    setPending(true);

    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      setError("Session expired. Sign in again.");
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("totp_recovery_code_hash")
      .eq("id", user.id)
      .single();

    if (profileError) {
      setPending(false);
      setError(profileError.message);
      return;
    }

    const submittedHash = await hashToken(values.recoveryCode.trim());
    if (!profile?.totp_recovery_code_hash || profile.totp_recovery_code_hash !== submittedHash) {
      setPending(false);
      setError("Invalid recovery code.");
      return;
    }

    // Recovery code is single-use: remove all TOTP factors and reset the
    // profile flags so the account drops back to password-only sign-in.
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setPending(false);
      setError(listError.message);
      return;
    }

    for (const factor of factors.totp) {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (unenrollError) {
        setPending(false);
        setError(unenrollError.message);
        return;
      }
    }

    const { error: resetError } = await supabase
      .from("profiles")
      .update({ totp_enabled: false, totp_recovery_code_hash: null })
      .eq("id", user.id);

    setPending(false);
    if (resetError) {
      setError(resetError.message);
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
      {useRecovery ? (
        <>
          <Typography.Paragraph type="secondary">
            Enter the recovery code you saved when enabling two-factor authentication. Using it disables TOTP on your account.
          </Typography.Paragraph>
          <Form layout="vertical" onFinish={onRecoverySubmit} requiredMark={false}>
            <Form.Item name="recoveryCode" label="Recovery code" rules={[{ required: true, message: "Enter your recovery code." }]}>
              <Input autoComplete="off" autoFocus placeholder="Recovery code" />
            </Form.Item>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Button block htmlType="submit" icon={<KeyOutlined />} loading={pending} type="primary">
              Recover access
            </Button>
            <Button block type="link" onClick={() => setUseRecovery(false)}>
              Back to authenticator code
            </Button>
          </Form>
        </>
      ) : (
        <>
          <Typography.Paragraph type="secondary">Enter the 6-digit code from your authenticator app.</Typography.Paragraph>
          <Form layout="vertical" onFinish={onSubmit} requiredMark={false}>
            <Form.Item name="code" label="Verification code" rules={[{ required: true, len: 6, message: "Enter the 6-digit code." }]}>
              <Input autoComplete="one-time-code" autoFocus inputMode="numeric" maxLength={6} placeholder="000000" />
            </Form.Item>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Button block htmlType="submit" icon={<SafetyCertificateOutlined />} loading={pending} type="primary">
              Verify
            </Button>
            <Button block type="link" onClick={() => setUseRecovery(true)}>
              Lost your device? Use a recovery code
            </Button>
          </Form>
        </>
      )}
    </Card>
  );
}
