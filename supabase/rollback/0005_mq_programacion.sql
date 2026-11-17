-- Solo en ensayo, antes de revertir 0004. Elimina creador y fecha de aviso.
begin;
drop function public.schedule_card_reminders(uuid,integer,timestamptz,timestamptz,uuid[]);
drop function public.complete_card(uuid,integer);
drop function public.lock_card_for_scheduling(uuid,integer);
drop trigger invalidate_card_reminders on public.cards;
drop function public.invalidate_card_reminders();
drop index public.card_assignees_user_idx;
alter table public.cards drop column created_by_user_id, drop column notify_at;
revoke insert (id,board_id,list_id,title,description,position) on public.cards from authenticated;
revoke update (title,description,list_id,position,archived_at) on public.cards from authenticated;
-- Restablece operaciones anteriores para usuarios autenticados; RLS sigue activo.
grant insert, update on public.cards to authenticated;
grant insert, update, delete on public.card_assignees to authenticated;
commit;
