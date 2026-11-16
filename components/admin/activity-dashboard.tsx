"use client";

import { useEffect, useState } from "react";

import styles from "./activity-dashboard.module.css";

type Row = { id: string; title: string; count: number };
type Totals = { totalMovements: number; movementsLastMinute: number };
type Board = Totals & { boardId: string; title: string; lists: Row[] };
type Activity = Totals & { generatedAt: string; boards: Board[] };

const numberFormat = new Intl.NumberFormat("es-CL");
const timeFormat = new Intl.DateTimeFormat("es-CL", { timeStyle: "medium" });

export function ActivityDashboard() {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [boardId, setBoardId] = useState("");
  const [status, setStatus] = useState<"loading" | "live" | "offline" | "forbidden">("loading");

  useEffect(() => {
    const controller = new AbortController();
    let nextPoll: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch("/api/admin/activity", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)])
        });
        if (response.status === 401 || response.status === 403) {
          setActivity(null);
          setStatus("forbidden");
          return;
        }
        if (!response.ok) throw new Error("No se pudo consultar la actividad.");
        const snapshot: Activity = await response.json();
        if (controller.signal.aborted) return;
        setActivity(snapshot);
        setStatus("live");
      } catch {
        if (!controller.signal.aborted) setStatus("offline");
      }
      if (!controller.signal.aborted) nextPoll = setTimeout(poll, 2_000);
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(nextPoll);
    };
  }, []);

  if (status === "forbidden") return <p className="panel" role="status">Tu sesión ya no tiene acceso a las métricas.</p>;

  const board = activity?.boards.find((entry) => entry.boardId === boardId);
  const totals = board ?? activity;
  const rows = board?.lists ?? activity?.boards.map((entry) => ({
    id: entry.boardId, title: entry.title, count: entry.totalMovements
  })) ?? [];
  const largestCount = rows.reduce((largest, row) => Math.max(largest, row.count), 1);
  const statusLabel = { live: "En vivo", offline: "Conexión interrumpida. Reintentando…", loading: "Conectando…" }[status];

  return (
    <section className={`panel ${styles.activity}`} aria-labelledby="activity-heading">
      <header className={styles.header}>
        <h2 id="activity-heading">Actividad en tiempo real</h2>
        <p role="status" className={styles.status} data-offline={status === "offline"}>{statusLabel}</p>
      </header>
      <label className={styles.filter}>
        Alcance
        <select value={board?.boardId ?? ""} onChange={(event) => setBoardId(event.currentTarget.value)}>
          <option value="">Todos los tableros</option>
          {activity?.boards.map((entry) => <option key={entry.boardId} value={entry.boardId}>{entry.title}</option>)}
        </select>
      </label>

      <div className={styles.content}>
        <dl className={styles.stats}>
          <div className={styles.primary}>
            <dt>Movimientos en el último minuto</dt>
            <dd>{totals ? numberFormat.format(totals.movementsLastMinute) : "—"}</dd>
          </div>
          <div className={styles.secondary}>
            <dt>Total acumulado</dt>
            <dd>{totals ? numberFormat.format(totals.totalMovements) : "—"}</dd>
          </div>
        </dl>

        <div className={styles.distribution}>
          <h3>{board ? "Movimientos por lista de destino" : "Movimientos por tablero"}</h3>
          {rows.length > 0 ? (
            <ul className={styles.bars}>
              {rows.map(({ id, title, count }) => (
                <li key={id} className={styles.barRow}>
                  <span>{title}</span>
                  <span className={styles.track} aria-hidden="true">
                    <span style={{ width: `${count / largestCount * 100}%` }} />
                  </span>
                  <strong>{numberFormat.format(count)}</strong>
                </li>
              ))}
            </ul>
          ) : <p className={styles.empty}>{activity ? "Aún no hay movimientos registrados." : "Sin datos de actividad."}</p>}
        </div>
      </div>

      {activity ? (
        <p className={styles.updated}>
          Última lectura <time dateTime={activity.generatedAt}>{timeFormat.format(new Date(activity.generatedAt))}</time>
        </p>
      ) : null}
    </section>
  );
}