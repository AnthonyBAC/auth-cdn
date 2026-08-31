"use client";

import { AppstoreAddOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, List, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type BoardSummary = { id: string; title: string; position: number };

export function BoardList({ workspaceId, boards, canEdit }: { workspaceId: string; boards: BoardSummary[]; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function createBoard(values: { title: string }) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/workspaces/${workspaceId}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values)
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? "Board could not be created.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="grid">
      <div className="toolbar">
        <Typography.Title level={2} style={{ margin: 0 }}>
          Boards
        </Typography.Title>
        <Link className="button secondary" href={`/workspaces/${workspaceId}/settings`}>
          Settings
        </Link>
      </div>
      {canEdit ? (
        <Card>
          <Form layout="inline" onFinish={createBoard}>
            <Form.Item name="title" rules={[{ required: true, message: "Name the board." }]} style={{ minWidth: 240 }}>
              <Input prefix={<AppstoreAddOutlined />} placeholder="Board title" />
            </Form.Item>
            <Button htmlType="submit" icon={<PlusOutlined />} loading={pending} type="primary">
              Create
            </Button>
          </Form>
          {error ? <Alert showIcon type="error" message={error} style={{ marginTop: 12 }} /> : null}
        </Card>
      ) : null}
      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 3 }}
        dataSource={boards}
        locale={{ emptyText: "No boards yet." }}
        renderItem={(board) => (
          <List.Item>
            <Link href={`/boards/${board.id}`}>
              <Card hoverable title={board.title}>
                <span className="muted">Open board</span>
              </Card>
            </Link>
          </List.Item>
        )}
      />
    </section>
  );
}
