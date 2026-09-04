"use client";

import { CheckCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Card } from "antd";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/invitations/${params.token}/accept`, { method: "POST" });
    setPending(false);
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? "Invitation could not be accepted.");
      return;
    }
    const body = await response.json();
    router.replace(`/workspaces/${body.workspaceId}`);
  }

  return (
    <Card className="auth-card" title="Workspace invitation">
      {error ? <Alert showIcon type="error" message={error} style={{ marginBottom: 12 }} /> : null}
      <Button block icon={<CheckCircleOutlined />} loading={pending} onClick={accept} type="primary">
        Accept invitation
      </Button>
    </Card>
  );
}
