-- Reversión de 0008_mq_consumidor.sql. No borra datos de negocio.
begin;
drop function if exists public.process_reminder_event(jsonb);
commit;
