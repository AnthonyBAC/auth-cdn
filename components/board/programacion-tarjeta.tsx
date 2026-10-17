"use client";

import { CheckOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Popconfirm, Select, Space, Typography } from "antd";
import { useState } from "react";

import { ApiRequestError, requestJson } from "@/lib/api/peticiones";
import { fromLocalDateInput, toLocalDateInput } from "@/lib/cards/fechas";
import type { BoardCard, AssigneeOption } from "@/lib/cards/tipos";
import { cardScheduleInput } from "@/lib/validation/programacion";

type Values = { dueAt: string; notifyAt: string; assigneeIds: string[] };
type SavedCard = Pick<BoardCard, "due_at" | "notify_at" | "completed_at" | "schedule_version">;
type Props = {
  card: BoardCard;
  members: AssigneeOption[];
  onSaved: () => void;
  onReload: () => Promise<BoardCard>;
};
function initialValues(card: BoardCard): Values {
  return {
    dueAt: toLocalDateInput(card.due_at),
    notifyAt: toLocalDateInput(card.notify_at),
    assigneeIds: card.card_assignees.map((entry) => entry.user_id)
  };
}

export function CardSchedulingForm({ card, members, onSaved, onReload }: Props) {
  const [form] = Form.useForm<Values>();
  const [saved, setSaved] = useState<SavedCard>(card);
  const [creatorId, setCreatorId] = useState(card.created_by_user_id);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedIds = Form.useWatch("assigneeIds", form) ?? initialValues(card).assigneeIds;
  const creator = members.find((member) => member.value === creatorId);
  const disabled = pending || conflict || Boolean(saved.completed_at);
  const options = [...members, ...selectedIds.filter((id: string) => !members.some((member) => member.value === id))
    .map((id: string) => ({ value: id, label: "Miembro no disponible (quítalo para guardar)", disabled: true }))];
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "No se pudo guardar el cambio.");
    if (reason instanceof ApiRequestError && reason.status === 409) setConflict(true);
  }

  async function save(values: Values) {
    setError(null);
    setMessage(null);
    try {
      const parsed = cardScheduleInput.safeParse({
        expectedVersion: saved.schedule_version,
        dueAt: fromLocalDateInput(values.dueAt, saved.due_at),
        notifyAt: fromLocalDateInput(values.notifyAt, saved.notify_at),
        assigneeIds: values.assigneeIds
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Revisa las fechas y los responsables.");
        return;
      }
      setPending(true);
      const response = await requestJson<{ card: SavedCard }>(`/api/cards/${card.id}/schedule`, "PATCH", parsed.data);
      if (!response?.card) throw new Error("No se pudo confirmar el guardado. Recarga los datos antes de continuar.");
      setSaved(response.card);
      setDirty(false);
      setMessage("Fechas y responsables guardados.");
      onSaved();
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  async function complete() {
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const response = await requestJson<{ card: SavedCard }>(`/api/cards/${card.id}/complete`, "POST", { expectedVersion: saved.schedule_version });
      if (!response?.card) throw new Error("No se pudo confirmar la finalización. Recarga los datos antes de continuar.");
      setSaved(response.card);
      setMessage("Tarjeta completada. Se cancelaron sus avisos pendientes.");
      onSaved();
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  async function reload() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const current = await onReload();
      form.setFieldsValue(initialValues(current));
      setSaved(current);
      setCreatorId(current.created_by_user_id);
      setDirty(false);
      setConflict(false);
      setMessage("Se cargaron los datos actuales de la tarjeta.");
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  return (
    <Form<Values> form={form} layout="vertical" initialValues={initialValues(card)} onFinish={save}
      onValuesChange={() => { setDirty(true); setMessage(null); }}>
      {saved.completed_at ? <Alert type="success" showIcon message="Esta tarjeta está completada." style={{ marginBottom: 16 }} /> : null}
      <Form.Item name="assigneeIds" label="Responsables">
        <Select mode="multiple" disabled={disabled} options={options} optionFilterProp="label"
          placeholder="Elige una o varias personas" allowClear />
      </Form.Item>
      <Typography.Paragraph type="secondary">
        {selectedIds.length > 0
          ? `Cada responsable recibirá su aviso (${selectedIds.length}).`
          : creator ? `Sin responsables, los avisos los recibirá quien creó la tarjeta: ${creator.label}.`
          : "Esta tarjeta no tiene un creador disponible. Elige al menos un responsable para programar avisos."}
      </Typography.Paragraph>
      <Form.Item name="dueAt" label="Fecha límite">
        <Input type="datetime-local" disabled={disabled} />
      </Form.Item>
      <Form.Item name="notifyAt" label="Fecha del aviso">
        <Input type="datetime-local" disabled={disabled} />
      </Form.Item>
      <Typography.Paragraph type="secondary">
        Fechas en tu zona horaria: {timeZone}. El aviso debe ser anterior a la fecha límite.
      </Typography.Paragraph>
      <Button disabled={disabled} onClick={() => {
        form.setFieldsValue({ dueAt: "", notifyAt: "" });
        setDirty(true);
        setMessage(null);
      }} style={{ marginBottom: 16 }}>Quitar fechas</Button>
      {error ? <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      {conflict ? <Alert type="warning" showIcon message="Tu borrador se conserva. Para continuar, carga la versión actual y vuelve a revisar los cambios." style={{ marginBottom: 12 }} /> : null}
      {message ? <Alert role="status" type="success" showIcon message={message} style={{ marginBottom: 12 }} /> : null}
      <Space wrap>
        <Button htmlType="submit" type="primary" icon={<SaveOutlined aria-hidden="true" />} loading={pending} disabled={disabled}>
          Guardar fechas y responsables
        </Button>
        <Popconfirm title="¿Completar esta tarjeta?" description="Se cancelarán los avisos pendientes de todos los responsables."
          okText="Sí, completar" cancelText="Volver" onConfirm={complete} disabled={disabled || dirty}>
          <Button icon={<CheckOutlined aria-hidden="true" />} disabled={disabled || dirty}>Completar tarjeta</Button>
        </Popconfirm>
        <Popconfirm title="¿Cargar los datos actuales?" description="Se reemplazará el borrador de este formulario."
          okText="Cargar datos" cancelText="Conservar borrador" onConfirm={reload} disabled={pending}>
          <Button icon={<ReloadOutlined aria-hidden="true" />} disabled={pending}>Cargar datos actuales</Button>
        </Popconfirm>
      </Space>
      {dirty ? <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>Guarda los cambios antes de completar la tarjeta. Quitar fechas también requiere guardar.</Typography.Paragraph> : null}
    </Form>
  );
}
