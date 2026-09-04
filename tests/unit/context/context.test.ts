import { describe, expect, it, vi } from "vitest";

import { getWorkspaceContext } from "@/lib/weather/context";

describe("workspace context", () => {
  it("returns unavailable when location is incomplete", async () => {
    await expect(getWorkspaceContext(null, () => Promise.reject(new Error("unused")))).resolves.toEqual({
      status: "unavailable",
      message: "Workspace location has not been configured."
    });
  });

  it("returns a non-blocking fallback when provider fails", async () => {
    const provider = vi.fn().mockRejectedValue(new Error("network"));
    const result = await getWorkspaceContext(
      { locationName: "Santiago", latitude: -33.45, longitude: -70.66, timezone: "America/Santiago" },
      provider
    );

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.message).toContain("unavailable");
    }
  });
});
