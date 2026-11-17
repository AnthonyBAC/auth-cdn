-- Technical retention and expiry reconciliation; never enables a remote job.
begin;
create function public.mq_rest_maintenance()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c record; v_expired integer:=0; v_inbox integer; v_outbox integer; v_alerts integer;
begin
  -- Preserve the shared card -> reminder lock order. The broker TTL cannot update
  -- Postgres: reconcile QUEUED reminders even when their MQ message has expired.
  for c in select cards.id from cards where exists(select 1 from task_reminders r
    where r.card_id=cards.id and r.status='QUEUED' and r.expires_at<=statement_timestamp())
    order by cards.id limit 100 for update skip locked
  loop
    update task_reminders set status='EXPIRED' where card_id=c.id and status='QUEUED' and expires_at<=statement_timestamp();
    v_expired:=v_expired+1;
  end loop;

  -- User-visible failure alert, deduplicated separately from the reminder event.
  -- RLS still limits recipients to their own notifications in active workspaces.
  insert into notifications(event_id,reminder_id,card_id,user_id,message)
    select md5('mq-publication-failed:'||o.event_id::text)::uuid,r.id,r.card_id,r.user_id,
      'No se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.'
    from notification_outbox o join task_reminders r on r.id=o.reminder_id
    where o.status='FAILED'
    on conflict(event_id,user_id) do nothing;
  get diagnostics v_alerts=row_count;

  -- Keep DONE payloads/tombstones for 30 days. Never purge pending work, FAILED
  -- publications or quarantine outputs; these require explicit operator recovery.
  delete from mq_rest_inbox where state='DONE' and completed_at < statement_timestamp()-interval '30 days'
    and output->>'purpose' is distinct from 'QUARANTINE';
  get diagnostics v_inbox=row_count;
  delete from notification_outbox where status in ('PUBLISHED','CANCELLED','EXPIRED')
    and updated_at < statement_timestamp()-interval '30 days';
  get diagnostics v_outbox=row_count;
  return jsonb_build_object('expiredCards',v_expired,'failureAlerts',v_alerts,'purgedInbox',v_inbox,'purgedOutbox',v_outbox);
end;
$$;
revoke all on function public.mq_rest_maintenance() from public,anon,authenticated;
grant execute on function public.mq_rest_maintenance() to service_role;

create function public.mq_rest_health()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'pendingInbox',(select count(*) from mq_rest_inbox where state<>'DONE'),
    'staleInbox',(select count(*) from mq_rest_inbox where state<>'DONE' and created_at < now()-interval '5 minutes'),
    'failedPublications',(select count(*) from notification_outbox where status='FAILED'),
    'quarantined',(select count(*) from mq_rest_inbox where output->>'purpose'='QUARANTINE'),
    'deliveryRetries',(select count(*) from mq_rest_inbox where state='OUTPUT' and output_attempts>1));
$$;
revoke all on function public.mq_rest_health() from public,anon,authenticated;
grant execute on function public.mq_rest_health() to service_role;
commit;
