import React from "react";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CardSchedulingForm } from "@/components/board/programacion-tarjeta";
import { BoardView } from "@/components/board/board-view";
import type { BoardCard } from "@/lib/cards/tipos";
import { toLocalDateInput } from "@/lib/cards/fechas";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const creator = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const card: BoardCard = {
  id: "00000000-0000-4000-8000-000000000003", title: "Entregar informe", description: null,
  list_id: "lista", position: 0, created_by_user_id: creator,
  due_at: "2099-01-03T00:00:12.345Z", notify_at: "2099-01-02T00:00:01.234Z",
  completed_at: null, schedule_version: 2, card_assignees: []
};
const members = [{ value: creator, label: "Ana" }, { value: second, label: "Luis" }];
const saved = vi.fn();
const reload = vi.fn();
const fetchMock = vi.fn();
function show(value: BoardCard = card) {
  return render(<CardSchedulingForm card={value} members={members} onSaved={saved} onReload={reload} />);
}
function response(status = 200, data: unknown = { card: { ...card, schedule_version: 3 } }) {
  return { ok: status < 400, status, json: async () => data };
}
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation((query) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
  })) });
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(response());
  reload.mockResolvedValue({ ...card, schedule_version: 4 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("formulario de fechas y responsables", () => {
  it("informa el destinatario alternativo y conserva la precisión de las fechas guardadas", async () => {
    show();
    expect(screen.getByText(/quien creó la tarjeta: Ana/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas y responsables" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ expectedVersion: 2, dueAt: card.due_at, notifyAt: card.notify_at, assigneeIds: [] });
    expect(await screen.findByText("Fechas y responsables guardados.")).toBeInTheDocument();
  });
  it("permite elegir varias personas y envía ambas", async () => {
    show();
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Ana"));
    fireEvent.click(await screen.findByText("Luis"));
    expect(screen.getByText("Cada responsable recibirá su aviso (2).")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas y responsables" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).assigneeIds).toEqual([creator, second]);
  });
  it("quitar fechas exige guardar y bloquea completar mientras hay cambios pendientes", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Quitar fechas" }));
    expect(screen.getByLabelText("Fecha límite")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Completar tarjeta" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas y responsables" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ dueAt: null, notifyAt: null });
  });
  it("valida el orden de fechas sin enviar una petición", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Fecha del aviso"), { target: { value: "2099-02-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas y responsables" }));
    expect(await screen.findByText("El aviso debe ser anterior al vencimiento.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("conserva el borrador ante conflicto y solo lo reemplaza tras confirmar la recarga", async () => {
    fetchMock.mockResolvedValue(response(409, { error: { message: "Otra persona cambió la tarjeta." } }));
    show();
    fireEvent.change(screen.getByLabelText("Fecha límite"), { target: { value: "2099-02-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas y responsables" }));
    expect(await screen.findByText("Otra persona cambió la tarjeta.")).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha límite")).toHaveValue("2099-02-01T10:00");
    expect(screen.getByRole("button", { name: "Guardar fechas y responsables" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cargar datos actuales" }));
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Cargar datos" }));
    expect(await screen.findByText("Se cargaron los datos actuales de la tarjeta.")).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha límite")).toHaveValue(toLocalDateInput(card.due_at));
    fetchMock.mockResolvedValue(response());
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas y responsables" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).expectedVersion).toBe(4);
  });
  it("permite reintentar tras un fallo de conexión sin perder fechas", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network error"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas y responsables" }));
    expect(await screen.findByText(/No se pudo conectar/)).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha límite")).toHaveValue(toLocalDateInput(card.due_at));
    expect(screen.getByRole("button", { name: "Guardar fechas y responsables" })).toBeEnabled();
  });
  it("completa solo tras confirmar y deshabilita la programación", async () => {
    fetchMock.mockResolvedValue(response(200, { card: { ...card, schedule_version: 3, completed_at: "2030-01-01T00:00:00Z" } }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Completar tarjeta" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Sí, completar" }));
    expect(await screen.findByText("Tarjeta completada. Se cancelaron sus avisos pendientes.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/cards/${card.id}/complete`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedVersion: 2 });
    expect(screen.getByRole("button", { name: "Completar tarjeta" })).toBeDisabled();
    expect(screen.getByLabelText("Fecha límite")).toBeDisabled();
  });
  it("explica que una tarjeta histórica necesita responsable", () => {
    show({ ...card, created_by_user_id: null });
    expect(screen.getByText(/no tiene un creador disponible/)).toBeInTheDocument();
  });
  it("el viewer ve fechas y estado pero no acciones para modificar", () => {
    render(<BoardView boardId="board" title="Tablero" canEdit={false} members={members} timeZone="America/Santiago"
      lists={[{ id: "lista", title: "Pendientes", position: 0, cards: [card] }]} />);
    expect(screen.getByText("Entregar informe")).toBeInTheDocument();
    expect(screen.getByText(/Fecha límite:/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fechas y responsables" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });
  it("evita crear dos tarjetas mientras la primera solicitud sigue en curso", async () => {
    let completeRequest: ((value: ReturnType<typeof response>) => void) | undefined;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { completeRequest = resolve; }));
    render(<BoardView boardId="board" title="Tablero" canEdit members={members} timeZone="America/Santiago"
      lists={[{ id: "lista", title: "Pendientes", position: 0, cards: [] }]} />);

    fireEvent.change(screen.getByPlaceholderText("Título de la tarjeta"), { target: { value: "No duplicar" } });
    const createButton = screen.getByRole("button", { name: "Agregar tarjeta" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(createButton).toBeDisabled();
    completeRequest?.(response(201, { card }));
    await waitFor(() => expect(createButton).toBeEnabled());
  });
});
