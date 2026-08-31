export type WorkspaceRole = "owner" | "editor" | "viewer";

export const roles: WorkspaceRole[] = ["owner", "editor", "viewer"];

export function canReadWorkspace(role: WorkspaceRole | null | undefined) {
  return role === "owner" || role === "editor" || role === "viewer";
}

export function canManageContent(role: WorkspaceRole | null | undefined) {
  return role === "owner" || role === "editor";
}

export function canManageMembership(role: WorkspaceRole | null | undefined) {
  return role === "owner";
}

export function canUpdateLocation(role: WorkspaceRole | null | undefined) {
  return role === "owner";
}

export function explainDenied(role: WorkspaceRole | null | undefined, action: string) {
  const label = role ?? "signed-out user";
  return `Your ${label} role does not have permission to ${action}.`;
}
