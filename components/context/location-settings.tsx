"use client";

import { EnvironmentOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, InputNumber } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

type LocationValues = {
  locationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export function LocationSettings({ workspaceId, initial, canEdit }: { workspaceId: string; initial: Partial<LocationValues>; canEdit: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(values: LocationValues) {
    setPending(true);
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/workspaces/${workspaceId}/location`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values)
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? "Location could not be saved.");
      return;
    }
    setMessage("Location saved.");
    router.refresh();
  }

  return (
    <Card title="Location context">
      <Form disabled={!canEdit} initialValues={initial} layout="vertical" onFinish={save} requiredMark={false}>
        <Form.Item name="locationName" label="Location" rules={[{ required: true, message: "Enter a location label." }]}>
          <Input prefix={<EnvironmentOutlined />} placeholder="Santiago, Chile" />
        </Form.Item>
        <Form.Item name="timezone" label="Timezone" rules={[{ required: true, message: "Enter an IANA timezone." }]}>
          <Input placeholder="America/Santiago" />
        </Form.Item>
        <div className="toolbar">
          <Form.Item name="latitude" label="Latitude" rules={[{ required: true, type: "number", min: -90, max: 90 }]}>
            <InputNumber style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="longitude" label="Longitude" rules={[{ required: true, type: "number", min: -180, max: 180 }]}>
            <InputNumber style={{ width: 180 }} />
          </Form.Item>
        </div>
        {!canEdit ? <Alert showIcon type="info" message="Only owners can update workspace location." /> : null}
        {error ? <Alert showIcon type="error" message={error} /> : null}
        {message ? <Alert showIcon type="success" message={message} /> : null}
        <Button disabled={!canEdit} htmlType="submit" icon={<SaveOutlined />} loading={pending} type="primary">
          Save location
        </Button>
      </Form>
    </Card>
  );
}
