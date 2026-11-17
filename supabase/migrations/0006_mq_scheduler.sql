-- Detecta avisos vencidos para envío; no confirma publicación en IBM MQ.
begin;
create function public.enqueue_due_reminders(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record; r record; v_event uuid; v_workspace uuid;
  v_now timestamptz := statement_timestamp();
  v_valid boolean; v_count integer := 0;
  v_queued integer := 0; v_cancelled integer := 0; v_expired integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'El tamaño del lote debe estar entre 1 y 1000.' using errcode = '22023';
  end if;
  -- Misma dirección de bloqueo que programación/completado: tarjeta -> recordatorio.
  -- SKIP LOCKED permite ejecuciones simultáneas sin procesar una tarjeta dos veces.
  for c in
    select cards.* from public.cards
    where exists (select 1 from public.task_reminders tr
      where tr.card_id = cards.id and tr.status = 'SCHEDULED' and tr.notify_at <= v_now)
    order by cards.id limit p_limit for update skip locked
  loop
    for r in select * from public.task_reminders
      where card_id = c.id and status = 'SCHEDULED' and notify_at <= v_now
      order by notify_at, id limit (p_limit - v_count) for update
    loop
      v_count := v_count + 1;
      select b.workspace_id, (c.archived_at is null and c.completed_at is null
        and c.schedule_version = r.schedule_version and c.due_at = r.due_at
        and l.archived_at is null and b.archived_at is null and w.archived_at is null
        and exists (select 1 from public.memberships m where m.workspace_id = w.id
          and m.user_id = r.user_id and m.status = 'active'))
      into v_workspace, v_valid
      from public.boards b join public.workspaces w on w.id = b.workspace_id
      join public.lists l on l.id = c.list_id and l.board_id = b.id
      where b.id = c.board_id;
      if not coalesce(v_valid, false) then
        update public.task_reminders set status = 'CANCELLED' where id = r.id;
        v_cancelled := v_cancelled + 1;
      elsif r.expires_at <= v_now then
        update public.task_reminders set status = 'EXPIRED' where id = r.id;
        v_expired := v_expired + 1;
      else
        v_event := gen_random_uuid();
        insert into public.notification_outbox(event_id, reminder_id, payload)
        values (v_event, r.id, jsonb_build_object(
          'schemaVersion', 1, 'eventId', v_event, 'eventType', r.kind,
          'reminderId', r.id, 'cardId', c.id, 'workspaceId', v_workspace,
          'scheduleVersion', r.schedule_version,
          'occurredAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'expiresAt', to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
        update public.task_reminders set status = 'QUEUED' where id = r.id;
        v_queued := v_queued + 1;
      end if;
    end loop;
    exit when v_count >= p_limit;
  end loop;
  return jsonb_build_object('queued', v_queued, 'cancelled', v_cancelled, 'expired', v_expired);
end;
$$;
revoke all on function public.enqueue_due_reminders(integer) from public, anon, authenticated;
grant execute on function public.enqueue_due_reminders(integer) to service_role;
commit;
