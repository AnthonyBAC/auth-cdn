"use client";

import { SafetyCertificateOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, QRCode, Space, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createToken, hashToken } from "@/lib/auth/tokens";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type EnrollmentData = {
  factorId: string;
  uri: string;
  secret: string;
};

export function MfaEnrollment({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  async function startEnrollment() {
    setError(null);
    setMessage(null);
    setRecoveryCode(null);
    setPending(true);

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app"
    });

    setPending(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }

    setEnrollment({ factorId: data.id, uri: data.totp.uri, secret: data.totp.secret });
  }

  async function cancelEnrollment() {
    setError(null);
    if (enrollment) {
      await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    }
    setEnrollment(null);
  }

  async function verifyEnrollment(values: { code: string }) {
    if (!enrollment) return;
    setError(null);
    setPending(true);

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrollment.factorId });
    if (challengeError) {
      setPending(false);
      setError(challengeError.message);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challenge.id,
      code: values.code
    });

    setPending(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    // Generate a one-time recovery code and persist only its hash plus the
    // enabled flag on the user's own profile row (RLS: update own profile).
    const code = createToken(9);
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Session expired. Sign in again to finish enabling two-factor authentication.");
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ totp_enabled: true, totp_recovery_code_hash: hashToken(code) })
      .eq("id", user.id);

    if (profileError) {
      setError(profileError.message);
      return;
    }

    setEnrollment(null);
    setRecoveryCode(code);
    router.refresh();
  }

  async function disableMfa() {
    setError(null);
    setMessage(null);
    setPending(true);

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

    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ totp_enabled: false, totp_recovery_code_hash: null })
        .eq("id", user.id);
      if (profileError) {
        setPending(false);
        setError(profileError.message);
        return;
      }
    }

    setPending(false);
    setRecoveryCode(null);
    setMessage("Two-factor authentication disabled.");
    router.refresh();
  }

  return (
    <Card className="auth-card" style={{ width: "100%", maxWidth: 480 }}>
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        Two-factor authentication (TOTP)
      </Typography.Title>

      {enrollment ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text>
            Scan this QR code with your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...) and enter the
            6-digit code it generates.
          </Typography.Text>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <QRCode value={enrollment.uri} size={200} />
          </div>
          <Typography.Paragraph copyable={{ text: enrollment.secret }} type="secondary" style={{ textAlign: "center" }}>
            {enrollment.secret}
          </Typography.Paragraph>
          <Form layout="vertical" onFinish={verifyEnrollment} requiredMark={false}>
            <Form.Item
              name="code"
              label="Verification code"
              rules={[{ required: true, len: 6, message: "Enter the 6-digit code." }]}
            >
              <Input autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="000000" />
            </Form.Item>
            {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
            <Space style={{ width: "100%", justifyContent: "flex-end" }}>
              <Button onClick={cancelEnrollment}>Cancel</Button>
              <Button htmlType="submit" loading={pending} type="primary">
                Verify and enable
              </Button>
            </Space>
          </Form>
        </Space>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {enabled
              ? "Two-factor authentication is enabled. You will need a code from your authenticator app every time you sign in."
              : "Add an extra layer of security. When enabled, signing in requires a 6-digit code from your authenticator app."}
          </Typography.Text>
          {error ? <Alert type="error" showIcon message={error} /> : null}
          {message ? <Alert type="success" showIcon message={message} /> : null}
          {recoveryCode ? (
            <Alert
              type="warning"
              showIcon
              message="Save your recovery code"
              description={
                <Space direction="vertical" size="small">
                  <Typography.Text>
                    If you lose access to your authenticator app, this code is the only way to sign in. It is shown once and only its
                    hash is stored.
                  </Typography.Text>
                  <Typography.Paragraph copyable={{ text: recoveryCode }} strong style={{ fontSize: 18, marginBottom: 0 }}>
                    {recoveryCode}
                  </Typography.Paragraph>
                </Space>
              }
            />
          ) : null}
          {enabled ? (
            <Button danger icon={<StopOutlined />} loading={pending} onClick={disableMfa}>
              Disable two-factor authentication
            </Button>
          ) : (
            <Button icon={<SafetyCertificateOutlined />} loading={pending} onClick={startEnrollment} type="primary">
              Enable two-factor authentication
            </Button>
          )}
        </Space>
      )}
    </Card>
  );
}
