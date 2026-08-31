import { describe, expect, it } from "vitest";

import { canManageContent, canManageMembership, canReadWorkspace, canUpdateLocation, explainDenied } from "@/lib/rbac/permissions";

describe("workspace permissions", () => {
  it("allows all active roles to read a workspace", () => {
    expect(canReadWorkspace("owner")).toBe(true);
    expect(canReadWorkspace("editor")).toBe(true);
    expect(canReadWorkspace("viewer")).toBe(true);
  });

  it("limits content management to owners and editors", () => {
    expect(canManageContent("owner")).toBe(true);
    expect(canManageContent("editor")).toBe(true);
    expect(canManageContent("viewer")).toBe(false);
  });

  it("limits membership and location changes to owners", () => {
    expect(canManageMembership("owner")).toBe(true);
    expect(canManageMembership("editor")).toBe(false);
    expect(canUpdateLocation("viewer")).toBe(false);
  });

  it("returns a clear denial message", () => {
    expect(explainDenied("viewer", "edit cards")).toContain("viewer");
    expect(explainDenied("viewer", "edit cards")).toContain("edit cards");
  });
});
