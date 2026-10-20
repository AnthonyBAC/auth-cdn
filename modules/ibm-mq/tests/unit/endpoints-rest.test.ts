// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "@/lib/auth/require-user";
import { createCloudMq } from "@/modules/ibm-mq/application/cloud";
import { apiError } from "@/lib/api/errors";
import { POST as tick } from "@/app/api/mq/tick/route";
import { POST as summary } from "@/app/api/boards/[boardId]/summary/route";
import { GET as notices } from "@/app/api/notifications/route";
import { PATCH as markRead } from "@/app/api/notifications/[notificationId]/route";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/modules/ibm-mq/application/cloud", () => ({ createCloudMq: vi.fn() }));
const uuid = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("MQ_CRON_SECRET", "x".repeat(40)); });
afterEach(() => vi.unstubAllEnvs());
describe("JWT, MFA, resource authorization and cloud service access", () => {
  it.each([401, 403])("rejects user messaging and notification access with session rejection %s", async (status) => {
    vi.mocked(requireUser).mockResolvedValue({ error: apiError(status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", "Denied") });
    expect((await summary(new Request("https://app.test"), { params: Promise.resolve({ boardId: uuid }) }))!.status).toBe(status);
    expect((await notices())!.status).toBe(status);
    expect((await markRead(new Request("https://app.test"), { params: Promise.resolve({ notificationId: uuid }) }))!.status).toBe(status);
    expect(createCloudMq).not.toHaveBeenCalled();
  });
  it("does not contact MQ for a valid session without workspace membership", async () => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn()
      .mockResolvedValueOnce({ data: { id: uuid, workspace_id: uuid, archived_at: null, workspaces: { archived_at: null } }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }) };
    vi.mocked(requireUser).mockResolvedValue({ user: { id: uuid }, supabase: { from: () => chain } } as never);
    expect((await summary(new Request("https://app.test"), { params: Promise.resolve({ boardId: uuid }) }))!.status).toBe(403);
    expect(createCloudMq).not.toHaveBeenCalled();
  });
  it("reads notices with the verified user's identity and session/RLS", async () => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
    vi.mocked(requireUser).mockResolvedValue({ user: { id: uuid }, supabase: { from: () => chain } } as never);
    expect((await notices())!.status).toBe(200); expect(chain.eq).toHaveBeenCalledWith("user_id", uuid);
  });
  it("requires an independent strong server credential for scheduled processing", async () => {
    expect((await tick(new Request("https://app.test", { method: "POST" }))).status).toBe(401);
    expect((await tick(new Request("https://app.test", { method: "POST", headers: { authorization: "Bearer user-session-jwt" } }))).status).toBe(401);
    expect(createCloudMq).not.toHaveBeenCalled();
    vi.mocked(createCloudMq).mockReturnValue({ tick: vi.fn().mockResolvedValue({ errors: 0 }), summary: vi.fn() });
    expect((await tick(new Request("https://app.test", { method: "POST", headers: { authorization: `Bearer ${"x".repeat(40)}` } }))).status).toBe(200);
  });
  it("fails closed when the service credential is absent or too short", async () => {
    vi.stubEnv("MQ_CRON_SECRET", "short");
    expect((await tick(new Request("https://app.test", { method: "POST" }))).status).toBe(503);
    expect(createCloudMq).not.toHaveBeenCalled();
  });
});
