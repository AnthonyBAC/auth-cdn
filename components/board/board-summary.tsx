"use client";

import { BarChartOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Statistic, Typography } from "antd";
import { useState } from "react";

import { requestJson } from "@/lib/api/peticiones";

type SummaryStats = {
  totalActive: number;
  pending: number;
  completed: number;
  overdue: number;
};

type SummaryResponse = {
  summary: SummaryStats;
  requestId: string;
  generatedAt: string;
};

export function BoardSummary({ boardId }: { boardId: string }) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await requestJson<SummaryResponse>(`/api/boards/${boardId}/summary`, "POST", {});
      if (!response) throw new Error("El servicio no devolvió el resumen.");
      setSummary(response.summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo obtener el resumen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card size="small" aria-live="polite">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space wrap align="center">
          <Button
            icon={summary ? <ReloadOutlined aria-hidden="true" /> : <BarChartOutlined aria-hidden="true" />}
            loading={loading}
            onClick={load}
            type="primary"
          >
            {summary ? "Volver a solicitar resumen" : "Resumen del tablero"}
          </Button>
          <Typography.Text type="secondary">
            El resumen se calcula en un worker independiente mediante IBM MQ.
          </Typography.Text>
        </Space>

        {error ? (
          <Alert
            action={<Button size="small" onClick={load}>Reintentar</Button>}
            message={error}
            showIcon
            type="error"
          />
        ) : null}

        {summary ? (
          <Space size="large" wrap>
            <Statistic title="Tarjetas activas" value={summary.totalActive} />
            <Statistic title="Pendientes" value={summary.pending} />
            <Statistic title="Completadas" value={summary.completed} />
            <Statistic title="Vencidas" value={summary.overdue} />
          </Space>
        ) : null}
      </Space>
    </Card>
  );
}
