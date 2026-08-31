"use client";

import { DeleteOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Popconfirm } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteWorkspaceButton({ workspaceId, canDelete }: { workspaceId: string; canDelete: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function deleteWorkspace() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/workspaces/${workspaceId}`, { method: "DELETE" });
    setPending(false);

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error?.message ?? "Workspace could not be deleted.");
      return;
    }

    router.replace("/workspaces");
    router.refresh();
  }

  return (
    <Card title="Delete workspace">
      <p className="muted">This archives the workspace and removes it from active workspace lists.</p>
      {!canDelete ? <Alert showIcon type="info" message="Only owners can delete workspaces." style={{ marginBottom: 12 }} /> : null}
      {error ? <Alert showIcon type="error" message={error} style={{ marginBottom: 12 }} /> : null}
      <Popconfirm
        title="Delete this workspace?"
        description="Boards, lists, and cards will no longer be shown in the app."
        okText="Delete"
        okButtonProps={{ danger: true }}
        onConfirm={deleteWorkspace}
      >
        <Button danger disabled={!canDelete} icon={<DeleteOutlined />} loading={pending}>
          Delete workspace
        </Button>
      </Popconfirm>
    </Card>
  );
}
