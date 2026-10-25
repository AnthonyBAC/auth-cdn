-- Reversión de ensayo. Conserva los eventos ya preparados.
begin;
drop function public.enqueue_due_reminders(integer);
commit;
