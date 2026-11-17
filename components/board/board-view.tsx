"use client";

import { CalendarOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SwapRightOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BoardSummary } from "@/components/board/board-summary";
import { CardSchedulingForm } from "@/components/board/programacion-tarjeta";
import { requestJson } from "@/lib/api/peticiones";
import { formatCardDate } from "@/lib/cards/fechas";
import type { BoardCard, BoardColumn, AssigneeOption } from "@/lib/cards/tipos";

export function BoardView({ boardId, title, lists, canEdit, members, timeZone }: {
  boardId: string; title: string; lists: BoardColumn[]; canEdit: boolean;
  members: AssigneeOption[]; timeZone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardCard | null>(null);

  const [scheduling, setScheduling] = useState<BoardCard | null>(null);

  async function post(url: string, payload: unknown, method = "POST") {
    setError(null);
    try {
      await requestJson(url, method, payload);
      router.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el cambio.");
      return false;
    }
  }

  async function archive(url: string) {
    setError(null);
    try {
      await requestJson(url, "DELETE");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo archivar.");
    }
  }

  async function reloadCard(cardId: string) {
    const response = await requestJson<{ board: { lists: BoardColumn[] } }>(`/api/boards/${boardId}`);
    const current = response?.board.lists.flatMap((list) => list.cards ?? []).find((card) => card.id === cardId);
    if (!current) throw new Error("Esta tarjeta ya no está disponible. Cierra el formulario y actualiza el tablero.");
    router.refresh();
    return current;
  }

  return (
    <section className="grid">
      <div className="toolbar">
        <Typography.Title level={1} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {!canEdit ? <Alert showIcon type="info" message="Tu rol permite ver el tablero, pero no modificarlo." /> : null}
      </div>
      {error ? <Alert showIcon type="error" message={error} /> : null}
      <BoardSummary boardId={boardId} />
      {canEdit ? (
        <Card>
          <Form layout="inline" onFinish={(values) => post(`/api/boards/${boardId}/lists`, values)}>
            <Form.Item name="title" rules={[{ required: true, message: "Escribe el nombre de la lista." }]} style={{ minWidth: 220 }}>
              <Input placeholder="Nombre de la lista" />
            </Form.Item>
            <Button htmlType="submit" icon={<PlusOutlined aria-hidden="true" />} type="primary">
              Agregar lista
            </Button>
          </Form>
        </Card>
      ) : null}
      <div className="board" aria-label="Listas del tablero">
        {lists.map((list) => (
          <section className="list-column" key={list.id} aria-label={list.title}>
            <div className="toolbar">
              <Typography.Title level={3} style={{ flex: 1, margin: 0 }}>
                {list.title}
              </Typography.Title>
              {canEdit ? (
                <Button aria-label={`Archivar ${list.title}`} icon={<DeleteOutlined aria-hidden="true" />} onClick={() => archive(`/api/lists/${list.id}`)} />
              ) : null}
            </div>
            {(list.cards ?? [])
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((card) => (
                <Card className="task-card" key={card.id} size="small" title={card.title}>
                  {card.description ? <p className="muted">{card.description}</p> : null}
                  <Space direction="vertical" size="small" style={{ marginBottom: 12 }}>
                    <Tag color={card.completed_at ? "green" : "blue"}>{card.completed_at ? "Completada" : "Pendiente"}</Tag>
                    {card.due_at ? <Typography.Text>Fecha límite: {formatCardDate(card.due_at, timeZone)} ({timeZone})</Typography.Text> : null}
                    {card.notify_at && !card.completed_at ? <Typography.Text type="secondary">Aviso: {formatCardDate(card.notify_at, timeZone)}</Typography.Text> : null}
                    <Typography.Text type="secondary">
                      {card.card_assignees.length > 0
                        ? `Responsables: ${card.card_assignees.map(({ user_id }) => members.find((member) => member.value === user_id)?.label ?? "Miembro no disponible").join(", ")}`
                        : `Sin responsables. Avisos para: ${members.find((member) => member.value === card.created_by_user_id)?.label ?? "elige un responsable"}.`}
                    </Typography.Text>
                  </Space>
                  {canEdit ? (
                    <Space wrap>
                      <Button icon={<EditOutlined aria-hidden="true" />} onClick={() => setEditing(card)}>
                        Editar
                      </Button>
                      <Button icon={<CalendarOutlined aria-hidden="true" />} onClick={() => setScheduling(card)}>
                        Fechas y responsables
                      </Button>
                      <Select
                        aria-label={`Mover ${card.title}`}
                        style={{ width: 160 }}
                        value={card.list_id}
                        suffixIcon={<SwapRightOutlined aria-hidden="true" />}
                        onChange={(listId) => post(`/api/cards/${card.id}/move`, { listId })}
                        options={lists.map((target) => ({ label: target.title, value: target.id }))}
                      />
                      <Button danger aria-label={`Archivar ${card.title}`} icon={<DeleteOutlined aria-hidden="true" />} onClick={() => archive(`/api/cards/${card.id}`)} />
                    </Space>
                  ) : null}
                </Card>
              ))}
            {canEdit ? (
              <Form layout="vertical" onFinish={(values) => post(`/api/lists/${list.id}/cards`, values)}>
                <Form.Item name="title" rules={[{ required: true, message: "Escribe el título de la tarjeta." }]}>
                  <Input placeholder="Título de la tarjeta" />
                </Form.Item>
                <Form.Item name="description">
                  <Input.TextArea placeholder="Descripción" rows={2} />
                </Form.Item>
                <Button block htmlType="submit" icon={<PlusOutlined aria-hidden="true" />} type="primary">
                  Agregar tarjeta
                </Button>
              </Form>
            ) : null}
          </section>
        ))}
      </div>
      <Modal
        destroyOnHidden
        title="Editar tarjeta"
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        footer={null}
      >
        {editing ? (
          <Form
            key={editing.id}
            initialValues={{ title: editing.title, description: editing.description }}
            layout="vertical"
            onFinish={async (values) => {
              const ok = await post(`/api/cards/${editing.id}`, values, "PATCH");
              if (ok) setEditing(null);
            }}
          >
            <Form.Item name="title" label="Título" rules={[{ required: true, message: "Escribe el título de la tarjeta." }]}>
              <Input />
            </Form.Item>
            <Form.Item name="description" label="Descripción">
              <Input.TextArea rows={4} />
            </Form.Item>
            <Button htmlType="submit" icon={<EditOutlined aria-hidden="true" />} type="primary">
              Guardar título y descripción
            </Button>
          </Form>
        ) : null}
      </Modal>
      <Modal destroyOnHidden title={scheduling ? `Fechas y responsables: ${scheduling.title}` : "Fechas y responsables"}
        open={Boolean(scheduling)} onCancel={() => setScheduling(null)} footer={null} width={640}>
        {scheduling ? <CardSchedulingForm key={scheduling.id} card={scheduling} members={members}
          onSaved={() => router.refresh()} onReload={() => reloadCard(scheduling.id)} /> : null}
      </Modal>
    </section>
  );
}
