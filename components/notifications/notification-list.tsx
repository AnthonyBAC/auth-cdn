"use client";
import { useEffect, useState } from "react";
import { Alert, Button, List, Space, Typography } from "antd";
import { requestJson } from "@/lib/api/peticiones";

type Notice = { id: string; message: string; created_at: string; read_at: string | null };
export function NotificationList() {
  const [items, setItems] = useState<Notice[]>([]);
  const [error, setError] = useState(false);
  async function load() {
    try {
      const result = await requestJson<{ notifications: Notice[] }>("/api/notifications");
      if (!result) throw new Error("Respuesta vacía.");
      setItems(result.notifications); setError(false);
    } catch { setError(true); }
  }
  useEffect(() => { void load(); }, []);
  async function read(id: string) {
    try { await requestJson(`/api/notifications/${id}`, "PATCH"); await load(); }
    catch { setError(true); }
  }
  return <Space direction="vertical" style={{ width: "100%" }}>
    <Typography.Title level={2}>Avisos</Typography.Title>
    <Button onClick={() => void load()}>Actualizar</Button>
    {error && <Alert type="error" message="No se pudieron cargar o actualizar los avisos. Revisa tu sesión e inténtalo otra vez." />}
    <List dataSource={items} locale={{ emptyText: "No tienes avisos." }} renderItem={(item) =>
      <List.Item actions={item.read_at ? [] : [<Button key="read" onClick={() => void read(item.id)}>Marcar leído</Button>]}>
        <List.Item.Meta title={item.message} description={new Date(item.created_at).toLocaleString()} />
      </List.Item>} />
  </Space>;
}
