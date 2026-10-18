// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError } from "@/lib/api/errors";
import { PATCH } from "@/app/api/cards/[cardId]/schedule/route";
import { POST } from "@/app/api/cards/[cardId]/complete/route";
import { requireUser } from "@/lib/auth/require-user";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));
const rpc = vi.fn();
const cardId = "00000000-0000-4000-8000-000000000003";
const params = Promise.resolve({ cardId });
const body = { expectedVersion: 1, dueAt: "2030-01-03T00:00:00Z", notifyAt: "2030-01-02T00:00:00Z", assigneeIds: [] };
function request(value: unknown = body) {
  return new Request("http://localhost/api/cards/test/schedule", { method: "PATCH", body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: cardId } } as unknown as Awaited<ReturnType<typeof requireUser>>);
  rpc.mockResolvedValue({ data: { id: cardId, schedule_version: 2 }, error: null });
});
describe("endpoints de programación", () => {
  it.each([401, 403])("respeta el rechazo de sesión/MFA %s", async (status) => {
    vi.mocked(requireUser).mockResolvedValue({ error: apiError(status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", "Acceso rechazado.") });
    expect((await PATCH(request(), { params })).status).toBe(status);
    expect((await POST(request(), { params })).status).toBe(status);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("envía responsables y fechas a una única RPC", async () => {
    const result = await PATCH(request(), { params });
    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("schedule_card_reminders", {
      target_card_id: cardId, expected_version: 1, due_at_input: body.dueAt,
      notify_at_input: body.notifyAt, assignee_ids: []
    });
  });
  it("rechaza JSON mal formado, identificadores y datos inválidos antes de escribir", async () => {
    const malformed = new Request("http://localhost", { method: "PATCH", body: "{" });
    expect((await PATCH(malformed, { params })).status).toBe(400);
    expect((await PATCH(request(), { params: Promise.resolve({ cardId: "incorrecto" }) })).status).toBe(400);
    expect((await PATCH(request({ ...body, expectedVersion: 0 }), { params })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["40001", 409], ["22023", 400], ["XX000", 500]])("traduce %s a %s", async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "detalle interno" } });
    const response = await PATCH(request(), { params });
    expect(response.status).toBe(status);
    if (status === 500) expect(await response.text()).not.toContain("detalle interno");
  });
  it("completa sin aceptar una fecha inventada por el navegador", async () => {
    expect((await POST(request({ expectedVersion: 2 }), { params })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("complete_card", { target_card_id: cardId, expected_version: 2 });
  });
});
