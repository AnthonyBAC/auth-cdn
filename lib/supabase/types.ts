import type { WorkspaceRole } from "@/lib/rbac/permissions";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Profile = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Workspace = {
  id: string;
  name: string;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type Membership = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: "invited" | "active" | "removed";
  profiles?: Pick<Profile, "id" | "email" | "name"> | null;
};

export type Board = {
  id: string;
  workspace_id: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type BoardList = {
  id: string;
  board_id: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type Card = {
  id: string;
  board_id: string;
  list_id: string;
  title: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
