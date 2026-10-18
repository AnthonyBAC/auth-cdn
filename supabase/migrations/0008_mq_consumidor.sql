-- Procesamiento del consumidor. Registra la notificación y el resultado de forma
-- atómica e idempotente. No publica, no modifica outbox y no implementa DLQ.
-- Aislada: solo agrega una función; no repite tablas ni migraciones anteriores.
begin;

create function public.process_reminder_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event_id uuid;
  v_reminder_id uuid;
  v_event_card uuid;
  v_reminder_card uuid;
  v_workspace_id uuid;
  v_kind text;
  v_schedule_version integer;
  v_event_expires timestamptz;
  v_outbox_event uuid;
  v_now timestamptz := statement_timestamp();
  v_card_workspace uuid;
  v_card public.cards;
  r public.task_reminders;
  v_message text;
begin
  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'Evento inválido.' using errcode = '22023';
  end if;
  -- Extracción defensiva: el contrato ya se validó en el consumidor, pero la función
  -- no confía en datos que llegan por la red.
  begin
    v_event_id := (p_event->>'eventId')::uuid;
    v_reminder_id := (p_event->>'reminderId')::uuid;
    v_event_card := (p_event->>'cardId')::uuid;
    v_workspace_id := (p_event->>'workspaceId')::uuid;
    v_kind := p_event->>'eventType';
    v_schedule_version := (p_event->>'scheduleVersion')::integer;
    v_event_expires := (p_event->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'Evento inválido.' using errcode = '22023';
  end;
  if v_event_id is null or v_reminder_id is null or v_event_card is null
     or v_workspace_id is null or v_kind is null
     or v_schedule_version is null or v_event_expires is null then
    raise exception 'Evento inválido.' using errcode = '22023';
  end if;

  -- Ubica la tarjeta para respetar el orden de bloqueo compartido: tarjeta -> recordatorio.
  select card_id into v_reminder_card from public.task_reminders where id = v_reminder_id;
  if v_reminder_card is null then
    return jsonb_build_object('outcome','CANCELLED','reason','REMINDER_NOT_FOUND');
  end if;

  select * into v_card from public.cards where id = v_reminder_card for update;
  if not found then
    return jsonb_build_object('outcome','CANCELLED','reason','CARD_NOT_FOUND');
  end if;
  select * into r from public.task_reminders where id = v_reminder_id for update;
  if not found then
    return jsonb_build_object('outcome','CANCELLED','reason','REMINDER_NOT_FOUND');
  end if;

  -- Coherencia del contrato con lo persistido.
  if r.card_id <> v_event_card or r.kind <> v_kind
     or r.schedule_version <> v_schedule_version then
    return jsonb_build_object('outcome','PERMANENT_ERROR','reason','EVENT_MISMATCH');
  end if;

  select b.workspace_id into v_card_workspace
    from public.boards b
    join public.lists l on l.id = v_card.list_id and l.board_id = b.id
    where b.id = v_card.board_id;
  if v_card_workspace is null or v_card_workspace <> v_workspace_id then
    return jsonb_build_object('outcome','PERMANENT_ERROR','reason','WORKSPACE_MISMATCH');
  end if;

  -- Idempotencia: un recordatorio ya resuelto no vuelve a notificar.
  if r.status = 'PROCESSED' then
    return jsonb_build_object('outcome','ALREADY_PROCESSED');
  end if;
  if r.status = 'CANCELLED' then
    return jsonb_build_object('outcome','CANCELLED');
  end if;
  if r.status = 'EXPIRED' then
    return jsonb_build_object('outcome','EXPIRED');
  end if;
  -- Solo se procesa un recordatorio que el scheduler dejó en cola.
  if r.status <> 'QUEUED' then
    return jsonb_build_object('outcome','PERMANENT_ERROR','reason','UNEXPECTED_STATUS');
  end if;

  -- Correspondencia con el outbox: si el recordatorio tiene un evento asociado, su
  -- event_id debe coincidir con el recibido. No se exige que la fila exista (puede
  -- haberse limpiado) ni un estado concreto (PUBLISHED no es obligatorio).
  select o.event_id into v_outbox_event
    from public.notification_outbox o where o.reminder_id = r.id;
  if v_outbox_event is not null and v_outbox_event <> v_event_id then
    return jsonb_build_object('outcome','PERMANENT_ERROR','reason','EVENT_MISMATCH');
  end if;

  -- Vigencia: el recordatorio o el mensaje ya caducaron.
  if r.expires_at <= v_now or v_event_expires <= v_now then
    update public.task_reminders set status = 'EXPIRED' where id = r.id and status = 'QUEUED';
    return jsonb_build_object('outcome','EXPIRED');
  end if;

  -- Estado actual de la tarjeta y sus contenedores.
  if v_card.archived_at is not null or v_card.completed_at is not null
     or v_card.schedule_version <> r.schedule_version
     or v_card.due_at is distinct from r.due_at
     or exists (select 1 from public.lists l where l.id = v_card.list_id and l.archived_at is not null)
     or exists (select 1 from public.boards b where b.id = v_card.board_id and b.archived_at is not null)
     or exists (select 1 from public.workspaces w where w.id = v_card_workspace and w.archived_at is not null) then
    update public.task_reminders set status = 'CANCELLED' where id = r.id and status = 'QUEUED';
    return jsonb_build_object('outcome','CANCELLED');
  end if;

  -- Destinatario con membresía activa.
  if not exists (select 1 from public.memberships m where m.workspace_id = v_card_workspace
       and m.user_id = r.user_id and m.status = 'active') then
    update public.task_reminders set status = 'CANCELLED' where id = r.id and status = 'QUEUED';
    return jsonb_build_object('outcome','CANCELLED');
  end if;

  -- Aviso visible; se deduplica por (event_id, user_id).
  v_message := case r.kind
    when 'TASK_OVERDUE' then format('La tarjeta "%s" está vencida.', v_card.title)
    else format('La tarjeta "%s" vence el %s.', v_card.title,
      to_char(r.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  end;
  insert into public.notifications(event_id, reminder_id, card_id, user_id, message)
    values (v_event_id, r.id, r.card_id, r.user_id, v_message)
    on conflict (event_id, user_id) do nothing;

  update public.task_reminders set status = 'PROCESSED', processed_at = v_now
    where id = r.id and status = 'QUEUED';
  if not found then
    return jsonb_build_object('outcome','ALREADY_PROCESSED');
  end if;
  return jsonb_build_object('outcome','PROCESSED');
end;
$$;
revoke all on function public.process_reminder_event(jsonb) from public, anon, authenticated;
grant execute on function public.process_reminder_event(jsonb) to service_role;
commit;
