import type { BoardList, Card, Profile } from "@/lib/supabase/types";

export type BoardCard = Pick<Card,
  "id" | "title" | "description" | "list_id" | "position" | "created_by_user_id" |
  "due_at" | "notify_at" | "completed_at" | "schedule_version"
> & { card_assignees: { user_id: string }[] };

export type BoardColumn = Pick<BoardList, "id" | "title" | "position"> & { cards?: BoardCard[] };
export type AssigneeOption = { value: string; label: string };
export type MemberProfileRow = { user_id: string; profiles: Pick<Profile, "name" | "email"> | Pick<Profile, "name" | "email">[] | null };

export function memberOptions(rows: MemberProfileRow[]): AssigneeOption[] {
  return rows.map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return { value: row.user_id, label: profile?.name ? `${profile.name} (${profile.email})` : profile?.email ?? row.user_id };
  });
}
