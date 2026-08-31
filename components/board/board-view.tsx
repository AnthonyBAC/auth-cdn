"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, SwapRightOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CardItem = {
  id: string;
  title: string;
  description: string | null;
  list_id: string;
  position: number;
};

type ListItem = {
  id: string;
  title: string;
  position: number;
  cards?: CardItem[];
};

export function BoardView({ boardId, title, lists, canEdit }: { boardId: string; title: string; lists: ListItem[]; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CardItem | null>(null);

  async function post(url: string, payload: unknown, method = "POST") {
    setError(null);
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? "Action failed.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function archive(url: string) {
    setError(null);
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? "Action failed.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="grid">
      <div className="toolbar">
        <Typography.Title level={1} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {!canEdit ? <Alert showIcon type="info" message="Viewer access is read-only." /> : null}
      </div>
      {error ? <Alert showIcon type="error" message={error} /> : null}
      {canEdit ? (
        <Card>
          <Form layout="inline" onFinish={(values) => post(`/api/boards/${boardId}/lists`, values)}>
            <Form.Item name="title" rules={[{ required: true, message: "Name the list." }]} style={{ minWidth: 220 }}>
              <Input placeholder="List title" />
            </Form.Item>
            <Button htmlType="submit" icon={<PlusOutlined />} type="primary">
              Add list
            </Button>
          </Form>
        </Card>
      ) : null}
      <div className="board" aria-label="Board lists">
        {lists.map((list) => (
          <section className="list-column" key={list.id} aria-label={list.title}>
            <div className="toolbar">
              <Typography.Title level={3} style={{ flex: 1, margin: 0 }}>
                {list.title}
              </Typography.Title>
              {canEdit ? (
                <Button aria-label={`Archive ${list.title}`} icon={<DeleteOutlined />} onClick={() => archive(`/api/lists/${list.id}`)} />
              ) : null}
            </div>
            {(list.cards ?? [])
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((card) => (
                <Card className="task-card" key={card.id} size="small" title={card.title}>
                  {card.description ? <p className="muted">{card.description}</p> : null}
                  {canEdit ? (
                    <Space wrap>
                      <Button icon={<EditOutlined />} onClick={() => setEditing(card)}>
                        Edit
                      </Button>
                      <Select
                        aria-label={`Move ${card.title}`}
                        style={{ width: 160 }}
                        value={card.list_id}
                        suffixIcon={<SwapRightOutlined />}
                        onChange={(listId) => post(`/api/cards/${card.id}/move`, { listId })}
                        options={lists.map((target) => ({ label: target.title, value: target.id }))}
                      />
                      <Button danger icon={<DeleteOutlined />} onClick={() => archive(`/api/cards/${card.id}`)} />
                    </Space>
                  ) : null}
                </Card>
              ))}
            {canEdit ? (
              <Form layout="vertical" onFinish={(values) => post(`/api/lists/${list.id}/cards`, values)}>
                <Form.Item name="title" rules={[{ required: true, message: "Name the card." }]}>
                  <Input placeholder="Card title" />
                </Form.Item>
                <Form.Item name="description">
                  <Input.TextArea placeholder="Details" rows={2} />
                </Form.Item>
                <Button block htmlType="submit" icon={<PlusOutlined />} type="primary">
                  Add card
                </Button>
              </Form>
            ) : null}
          </section>
        ))}
      </div>
      <Modal
        destroyOnClose
        title="Edit card"
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        footer={null}
      >
        {editing ? (
          <Form
            initialValues={{ title: editing.title, description: editing.description }}
            layout="vertical"
            onFinish={async (values) => {
              const ok = await post(`/api/cards/${editing.id}`, values, "PATCH");
              if (ok) setEditing(null);
            }}
          >
            <Form.Item name="title" label="Title" rules={[{ required: true, message: "Name the card." }]}>
              <Input />
            </Form.Item>
            <Form.Item name="description" label="Description">
              <Input.TextArea rows={4} />
            </Form.Item>
            <Button htmlType="submit" icon={<EditOutlined />} type="primary">
              Save
            </Button>
          </Form>
        ) : null}
      </Modal>
    </section>
  );
}
