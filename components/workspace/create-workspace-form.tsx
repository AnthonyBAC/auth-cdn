"use client";

import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(values: { name: string }) {
    setPending(true);
    setError(null);
    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values)
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? "Workspace could not be created.");
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <Form layout="inline" onFinish={create}>
        <Form.Item name="name" rules={[{ required: true, message: "Name the workspace." }]} style={{ minWidth: 260 }}>
          <Input placeholder="New workspace" />
        </Form.Item>
        <Button htmlType="submit" icon={<PlusOutlined />} loading={pending} type="primary">
          Create workspace
        </Button>
      </Form>
      {error ? <Alert showIcon type="error" message={error} style={{ marginTop: 12 }} /> : null}
    </Card>
  );
}
