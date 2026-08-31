"use client";

import { DeleteOutlined, MailOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Select, Space, Table, Tag } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type Member = {
  user_id: string;
  role: "owner" | "editor" | "viewer";
  status: string;
  profiles?: { email: string; name: string } | null;
};

const roleOptions = [
  { label: "Owner", value: "owner" },
  { label: "Editor", value: "editor" },
  { label: "Viewer", value: "viewer" }
];

export function MemberManagement({ workspaceId, members, canManage }: { workspaceId: string; members: Member[]; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  async function request(url: string, method: string, body?: unknown) {
    setError(null);
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error?.message ?? "Action failed.");
      return null;
    }
    router.refresh();
    return response.status === 204 ? {} : response.json();
  }

  async function sendInvite(values: { email: string; role: "owner" | "editor" | "viewer" }) {
    const body = await request(`/api/workspaces/${workspaceId}/invitations`, "POST", values);
    if (body?.token) setInvite(`${location.origin}/invitations/${body.token}`);
  }

  return (
    <Card title="Members">
      {!canManage ? <Alert showIcon type="info" message="Only owners can invite members or change roles." style={{ marginBottom: 12 }} /> : null}
      {error ? <Alert showIcon type="error" message={error} style={{ marginBottom: 12 }} /> : null}
      {invite ? <Alert showIcon type="success" message="Invitation link created" description={invite} style={{ marginBottom: 12 }} /> : null}
      <Table
        rowKey="user_id"
        pagination={false}
        dataSource={members}
        columns={[
          {
            title: "Name",
            render: (_, member) => member.profiles?.name ?? member.profiles?.email ?? member.user_id
          },
          {
            title: "Role",
            render: (_, member) => (
              <Select
                disabled={!canManage}
                defaultValue={member.role}
                options={roleOptions}
                style={{ width: 130 }}
                onChange={(role) => request(`/api/workspaces/${workspaceId}/members/${member.user_id}`, "PATCH", { role })}
              />
            )
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (status) => <Tag>{status}</Tag>
          },
          {
            title: "Actions",
            render: (_, member) => (
              <Button
                danger
                disabled={!canManage}
                icon={<DeleteOutlined />}
                onClick={() => request(`/api/workspaces/${workspaceId}/members/${member.user_id}`, "DELETE")}
              >
                Remove
              </Button>
            )
          }
        ]}
      />
      <Form disabled={!canManage} layout="inline" onFinish={sendInvite} style={{ marginTop: 16 }}>
        <Form.Item name="email" rules={[{ required: true, type: "email", message: "Enter an email." }]} style={{ minWidth: 240 }}>
          <Input prefix={<MailOutlined />} placeholder="collaborator@example.com" />
        </Form.Item>
        <Form.Item name="role" initialValue="editor">
          <Select options={roleOptions} style={{ width: 130 }} />
        </Form.Item>
        <Space>
          <Button htmlType="submit" icon={<SaveOutlined />} type="primary">
            Invite
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
