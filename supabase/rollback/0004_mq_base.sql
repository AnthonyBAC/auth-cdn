-- Solo para revertir la migración 0004 en una base de ensayo.
-- Destructivo: elimina recordatorios, outbox, notificaciones y fechas de tarjetas.
-- No ejecutar si existen migraciones posteriores que dependan de estos objetos.
begin;
drop table public.notifications;
drop table public.notification_outbox;
drop table public.task_reminders;
alter table public.cards
  drop constraint cards_schedule_version_positive,
  drop column schedule_version,
  drop column completed_at,
  drop column due_at;
commit;
