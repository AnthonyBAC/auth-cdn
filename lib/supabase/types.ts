import type { ReminderKind, ReminderStatus, OutboxStatus, ReminderEvent } from "@/lib/mq/contrato";
import type { WorkspaceRole } from "@/lib/rbac/permissions";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Profile = {
  id: string;
  email: string;
  name: string;
  totp_enabled: boolean;
  totp_recovery_code_hash: string | null;
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
  created_by_user_id: string | null;
  notify_at: string | null;
  due_at: string | null;
  completed_at: string | null;
  schedule_version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};


export type TaskReminder = {
  id: string;
  card_id: string;
  user_id: string;
  kind: ReminderKind;
  schedule_version: number;
  due_at: string;
  notify_at: string;
  expires_at: string;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export type NotificationOutbox = {
  event_id: string;
  reminder_id: string;
  payload: ReminderEvent;
  status: OutboxStatus;
  attempts: number;
  next_attempt_at: string;
  lock_token: string | null;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type Notification = {
  id: string;
  event_id: string;
  reminder_id: string | null;
  card_id: string;
  user_id: string;
  message: string;
  created_at: string;
  updated_at: string;
  read_at: string | null;
};
