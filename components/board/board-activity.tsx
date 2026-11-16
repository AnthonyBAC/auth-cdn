"use client";

import { useEffect, useId, useState } from "react";

import styles from "./board-activity.module.css";

type Activity = {
  generatedAt: string;
  totalMovements: number;
  movementsLastMinute: number;
  byDestinationList: Record<string, number>;
};

const numberFormat = new Intl.NumberFormat("es-CL");
const timeFormat = new Intl.DateTimeFormat("es-CL", { timeStyle: "medium" });

export function BoardActivity({ boardId, lists }: {
  boardId: string;
  lists: { id: string; title: string }[];
}) {
  const titleId = useId();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let nextPoll: ReturnType<typeof setTimeout>;

    async function poll() {
      const requestController = new AbortController();
      const requestTimeout = setTimeout(() => requestController.abort(), 4_000);

      try {
        const response = await fetch(`/api/boards/${boardId}/activity`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, requestController.signal])
        });
        if (!response.ok) throw new Error("No se pudo consultar la actividad.");
        const snapshot: Activity = await response.json();
        if (controller.signal.aborted) return;
        setActivity(snapshot);
        setOffline(false);
      } catch {
        if (!controller.signal.aborted) setOffline(true);
      } finally {
        clearTimeout(requestTimeout);
        if (!controller.signal.aborted) nextPoll = setTimeout(poll, 2_000);
      }
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(nextPoll);
    };
  }, [boardId]);

  const rows = lists.map(({ id, title }) => ({ id, title, count: activity?.byDestinationList[id] ?? 0 }));
  const listedMovements = rows.reduce((total, row) => total + row.count, 0);
  const otherMovements = (activity?.totalMovements ?? 0) - listedMovements;
  if (otherMovements > 0) rows.push({ id: "other", title: "Otras listas", count: otherMovements });
  const largestCount = Math.max(1, ...rows.map((row) => row.count));

  return (
    <section className={`panel ${styles.activity}`} aria-labelledby={titleId}>
      <header className={styles.header}>
        <h2 id={titleId}>Actividad en tiempo real</h2>
        <p role="status" className={styles.status} data-offline={offline}>
          {offline ? "Conexión interrumpida. Reintentando…" : activity ? "En vivo" : "Conectando…"}
        </p>
      </header>

      <div className={styles.content}>
        <dl className={styles.stats}>
          <div className={styles.primary}>
            <dt>Movimientos en el último minuto</dt>
            <dd>{activity ? numberFormat.format(activity.movementsLastMinute) : "—"}</dd>
          </div>
          <div className={styles.secondary}>
            <dt>Total acumulado</dt>
            <dd>{activity ? numberFormat.format(activity.totalMovements) : "—"}</dd>
          </div>
        </dl>

        <div className={styles.distribution}>
          <h3>Movimientos por lista de destino</h3>
          {activity && rows.length > 0 ? (
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
          ) : <p className={styles.empty}>{activity ? "El tablero aún no tiene listas con actividad." : "Sin datos de actividad."}</p>}
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