// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudMq } from "@/modules/ibm-mq/application/cloud";
import { solicitarResumenRemoto } from "@/modules/ibm-mq/application/resumen-cliente";
vi.mock("@/modules/ibm-mq/application/cloud", () => ({ createCloudMq: vi.fn() }));
const input = { boardId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222" };
beforeEach(() => vi.clearAllMocks());
describe("cloud REST summary client", () => {
  it("uses the cloud responder without localhost or a bridge token", async () => {
    const reply = { boardId: input.boardId, status: "OK" };
    const summary = vi.fn().mockResolvedValue(reply);
    vi.mocked(createCloudMq).mockReturnValue({ summary, tick: vi.fn() });
    expect(await solicitarResumenRemoto(input)).toEqual(reply);
    expect(summary).toHaveBeenCalledWith(input);
  });
  it("maps an interactive timeout to 504", async () => {
    vi.mocked(createCloudMq).mockReturnValue({ summary: vi.fn().mockRejectedValue(new Error("SUMMARY_TIMEOUT")), tick: vi.fn() });
    await expect(solicitarResumenRemoto(input)).rejects.toMatchObject({ status: 504, code: "GATEWAY_TIMEOUT" });
  });
  it("does not expose underlying credentials or errors", async () => {
    vi.mocked(createCloudMq).mockImplementation(() => { throw new Error("private-credential"); });
    const error = await solicitarResumenRemoto(input).catch(e => e);
    expect(error.status).toBe(503); expect(error.message).not.toContain("private-credential");
  });
});
