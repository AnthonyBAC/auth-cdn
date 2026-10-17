-- Conserva eventos y estados. Las reservas existentes vencerán al reinstalar.
begin;
drop function public.finish_notification_event(uuid,uuid,text);
drop function public.claim_notification_event();
commit;
