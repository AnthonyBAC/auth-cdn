-- Reserva de publicación y confirmación. Acceso exclusivo de procesos de servidor.
begin;
create function public.claim_notification_event()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record; r record; o record; v_valid boolean; v_token uuid;
  v_now timestamptz := statement_timestamp(); v_checked integer := 0;
begin
  -- Orden compartido con programación: tarjeta, recordatorio, outbox.
  for c in select cards.* from public.cards where exists (
    select 1 from public.task_reminders tr join public.notification_outbox ob on ob.reminder_id=tr.id
    where tr.card_id=cards.id and ((ob.status='PENDING' and ob.next_attempt_at<=v_now)
      or (ob.status='PROCESSING' and ob.locked_until<=v_now)))
    order by cards.id limit 100 for update skip locked
  loop
    for r in select tr.* from public.task_reminders tr
      join public.notification_outbox ob on ob.reminder_id=tr.id
      where tr.card_id=c.id and ((ob.status='PENDING' and ob.next_attempt_at<=v_now)
        or (ob.status='PROCESSING' and ob.locked_until<=v_now))
      order by ob.next_attempt_at,ob.event_id limit (100-v_checked) for update of tr
    loop
      v_checked := v_checked+1;
      select * into o from public.notification_outbox where reminder_id=r.id for update;
      select (c.archived_at is null and c.completed_at is null and c.schedule_version=r.schedule_version
        and c.due_at=r.due_at and r.status='QUEUED'
        and l.archived_at is null and b.archived_at is null and w.archived_at is null
        and exists(select 1 from public.memberships m where m.workspace_id=w.id
          and m.user_id=r.user_id and m.status='active')) into v_valid
      from public.boards b join public.workspaces w on w.id=b.workspace_id
        join public.lists l on l.id=c.list_id and l.board_id=b.id where b.id=c.board_id;
      if not coalesce(v_valid,false) or r.expires_at<=v_now or o.attempts>=5 then
        update public.notification_outbox set
          status=case when not coalesce(v_valid,false) then 'CANCELLED'
            when r.expires_at<=v_now then 'EXPIRED' else 'FAILED' end,
          lock_token=null,locked_until=null,
          last_error=case when o.attempts>=5 then 'MAX_ATTEMPTS' else null end
          where event_id=o.event_id;
        update public.task_reminders set status=case
          when not coalesce(v_valid,false) then 'CANCELLED'
          when r.expires_at<=v_now then 'EXPIRED' else 'FAILED' end
          where id=r.id and status='QUEUED';
      else
        v_token:=gen_random_uuid();
        update public.notification_outbox set status='PROCESSING',attempts=attempts+1,
          lock_token=v_token,locked_until=v_now+interval '120 seconds'
          where event_id=o.event_id;
        return jsonb_build_object('eventId',o.event_id,'lockToken',v_token,'payload',o.payload);
      end if;
    end loop;
    exit when v_checked>=100;
  end loop;
  return null;
end;
$$;

create function public.finish_notification_event(p_event_id uuid,p_lock_token uuid,p_result text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_card uuid; v_reminder uuid; o record; v_now timestamptz:=statement_timestamp();
begin
  if p_result is null or p_result not in ('PUBLISHED','RETRY','INVALID') then
    raise exception 'Resultado de publicación inválido.' using errcode='22023';
  end if;
  select r.card_id,r.id into v_card,v_reminder from public.task_reminders r
    join public.notification_outbox ob on ob.reminder_id=r.id where ob.event_id=p_event_id;
  if not found then return false; end if;
  perform 1 from public.cards where id=v_card for update;
  perform 1 from public.task_reminders where id=v_reminder for update;
  select * into o from public.notification_outbox where event_id=p_event_id for update;
  if not found or o.status<>'PROCESSING' or o.lock_token is distinct from p_lock_token
    or o.locked_until<=v_now then return false; end if;
  update public.notification_outbox set
    status=case when p_result='PUBLISHED' then 'PUBLISHED'
      when p_result='INVALID' or attempts>=5 then 'FAILED' else 'PENDING' end,
    published_at=case when p_result='PUBLISHED' then v_now else null end,
    next_attempt_at=v_now+make_interval(secs=>least(300,5*power(2,attempts-1))::integer),
    last_error=case when p_result='PUBLISHED' then null
      when p_result='INVALID' then 'INVALID_EVENT' else 'MQ_PUBLICATION_UNCONFIRMED' end,
    lock_token=null,locked_until=null where event_id=p_event_id;
  if p_result='INVALID' or (p_result='RETRY' and o.attempts>=5) then
    update public.task_reminders set status='FAILED' where id=v_reminder and status='QUEUED';
  end if;
  return true;
end;
$$;
revoke all on function public.claim_notification_event() from public,anon,authenticated;
revoke all on function public.finish_notification_event(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_notification_event() to service_role;
grant execute on function public.finish_notification_event(uuid,uuid,text) to service_role;
commit;
