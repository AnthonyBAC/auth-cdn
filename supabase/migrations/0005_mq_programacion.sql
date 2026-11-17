-- Responsables, programación y finalización. No publica en IBM MQ.
begin;

-- No inferir autores de tarjetas históricas. Solo las nuevas reciben el usuario actual.
alter table public.cards
  add column created_by_user_id uuid references public.profiles(id) on delete set null,
  add column notify_at timestamptz;
alter table public.cards alter column created_by_user_id set default auth.uid();
create index cards_creator_idx on public.cards(created_by_user_id);
create index card_assignees_user_idx on public.card_assignees(user_id);

create function public.invalidate_card_reminders()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.due_at is distinct from old.due_at
     or new.notify_at is distinct from old.notify_at
     or new.completed_at is distinct from old.completed_at
     or new.archived_at is distinct from old.archived_at
     or new.schedule_version is distinct from old.schedule_version then
    new.schedule_version := old.schedule_version + 1;
    update public.task_reminders set status = 'CANCELLED'
      where card_id = old.id and status in ('SCHEDULED', 'QUEUED', 'FAILED');
    update public.notification_outbox o
      set status = 'CANCELLED', lock_token = null, locked_until = null
      from public.task_reminders r
      where o.reminder_id = r.id and r.card_id = old.id and r.status = 'CANCELLED'
        and o.status in ('PENDING', 'PROCESSING', 'FAILED');
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_card_reminders() from public, anon, authenticated;
create trigger invalidate_card_reminders before update on public.cards
  for each row execute function public.invalidate_card_reminders();

-- Helper interno, no invocable desde el navegador.
create function public.lock_card_for_scheduling(target_card_id uuid, expected_version integer)
returns public.cards language plpgsql security definer set search_path = public as $$
declare selected_card public.cards;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para continuar.' using errcode = '42501';
  end if;
  if exists (select 1 from auth.mfa_factors where user_id = auth.uid()
    and factor_type = 'totp' and status = 'verified')
    and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Completa la verificación de dos pasos.' using errcode = '42501';
  end if;
  if expected_version is null or expected_version < 1 then
    raise exception 'La versión de programación es obligatoria.' using errcode = '22023';
  end if;
  select c.* into selected_card from public.cards c
    join public.lists l on l.id = c.list_id and l.board_id = c.board_id
    join public.boards b on b.id = c.board_id
    join public.workspaces w on w.id = b.workspace_id
    join public.memberships m on m.workspace_id = w.id and m.user_id = auth.uid()
    where c.id = target_card_id and c.archived_at is null and l.archived_at is null
      and b.archived_at is null and w.archived_at is null
      and m.status = 'active' and public.can_edit_workspace_content(w.id)
    for update of c for share of l, b, w, m;
  if not found then
    raise exception 'No tienes permiso sobre esta tarjeta activa.' using errcode = '42501';
  end if;
  if selected_card.schedule_version <> expected_version then
    raise exception 'La tarjeta cambió. Actualiza los datos e inténtalo nuevamente.' using errcode = '40001';
  end if;
  return selected_card;
end;
$$;
revoke all on function public.lock_card_for_scheduling(uuid, integer) from public, anon, authenticated;

create function public.schedule_card_reminders(
  target_card_id uuid, expected_version integer,
  due_at_input timestamptz, notify_at_input timestamptz, assignee_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  selected_card public.cards;
  workspace_id_value uuid;
  recipients uuid[];
  previous_assignees uuid[];
  sorted_assignees uuid[];
  active_count integer;
  new_version integer;
  dates_changed boolean;
  current_time_value timestamptz;
begin
  selected_card := public.lock_card_for_scheduling(target_card_id, expected_version);
  current_time_value := clock_timestamp();
  if selected_card.completed_at is not null then
    raise exception 'No se puede programar una tarjeta completada.' using errcode = '22023';
  end if;
  if assignee_ids is null or array_position(assignee_ids, null) is not null then
    raise exception 'Indica una lista de responsables válida.' using errcode = '22023';
  end if;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into sorted_assignees
    from (select distinct unnest(assignee_ids) id) s;
  if cardinality(sorted_assignees) <> cardinality(assignee_ids) then
    raise exception 'No repitas responsables.' using errcode = '22023';
  end if;
  select workspace_id into workspace_id_value from public.boards where id = selected_card.board_id;
  -- Bloquea las membresías para no aceptar responsables retirados durante el guardado.
  perform 1 from public.memberships where workspace_id = workspace_id_value
    and user_id = any(sorted_assignees) and status = 'active' order by user_id for share;
  get diagnostics active_count = row_count;
  if active_count <> cardinality(sorted_assignees) then
    raise exception 'Todos los responsables deben ser miembros activos del workspace.' using errcode = '22023';
  end if;
  if (due_at_input is null) <> (notify_at_input is null) then
    raise exception 'Indica vencimiento y aviso, o elimina ambos.' using errcode = '22023';
  end if;
  dates_changed := due_at_input is distinct from selected_card.due_at
    or notify_at_input is distinct from selected_card.notify_at;
  if due_at_input is not null and (
    not isfinite(due_at_input) or not isfinite(notify_at_input)
    or due_at_input <= notify_at_input
    or (dates_changed and notify_at_input <= current_time_value)
  ) then
    raise exception 'El aviso nuevo debe ser futuro y anterior al vencimiento.' using errcode = '22023';
  end if;

  recipients := sorted_assignees;
  if due_at_input is not null and cardinality(recipients) = 0 then
    if selected_card.created_by_user_id is null then
      raise exception 'Esta tarjeta antigua no tiene creador registrado. Elige un responsable.' using errcode = '22023';
    end if;
    perform 1 from public.memberships where workspace_id = workspace_id_value
      and user_id = selected_card.created_by_user_id and status = 'active' for share;
    if not found then
      raise exception 'El creador ya no pertenece al workspace. Elige un responsable.' using errcode = '22023';
    end if;
    recipients := array[selected_card.created_by_user_id];
  end if;
  select coalesce(array_agg(user_id order by user_id), '{}'::uuid[]) into previous_assignees
    from public.card_assignees where card_id = target_card_id;

  -- Repetir exactamente el guardado no genera otra versión ni más recordatorios.
  if not dates_changed and previous_assignees = sorted_assignees then
    new_version := selected_card.schedule_version;
  else
    delete from public.card_assignees where card_id = target_card_id;
    insert into public.card_assignees(card_id, user_id)
      select target_card_id, unnest(sorted_assignees);
    update public.cards set due_at = due_at_input, notify_at = notify_at_input,
      schedule_version = schedule_version + 1
      where id = target_card_id returning schedule_version into new_version;

    if due_at_input is not null then
      -- Un registro por tipo y destinatario; el vencido caduca 24 horas después.
      -- Si solo cambian responsables, no repetir avisos ya procesados para los que permanecen.
      insert into public.task_reminders
        (card_id,user_id,kind,schedule_version,due_at,notify_at,expires_at,status,processed_at)
      select target_card_id, recipient, event.kind, new_version,
        due_at_input, event.notify_at, event.expires_at,
        case when prior.processed_at is not null then 'PROCESSED'
             when event.expires_at <= current_time_value then 'EXPIRED'
             else 'SCHEDULED' end,
        prior.processed_at
      from unnest(recipients) recipient
      cross join (values
        ('TASK_REMINDER_DUE', notify_at_input, due_at_input),
        ('TASK_OVERDUE', due_at_input, due_at_input + interval '24 hours')
      ) as event(kind,notify_at,expires_at)
      left join lateral (
        select coalesce(r.processed_at,r.updated_at) as processed_at
        from public.task_reminders r
        where not dates_changed and r.card_id = target_card_id and r.user_id = recipient
          and r.kind = event.kind and r.schedule_version = selected_card.schedule_version
          and r.status = 'PROCESSED'
        limit 1
      ) prior on true;
    end if;
  end if;
  return jsonb_build_object('id',target_card_id,'due_at',due_at_input,'notify_at',notify_at_input,
    'completed_at',null,'schedule_version',new_version,'assignee_ids',sorted_assignees);
end;
$$;
revoke all on function public.schedule_card_reminders(uuid,integer,timestamptz,timestamptz,uuid[])
  from public, anon, authenticated;
grant execute on function public.schedule_card_reminders(uuid,integer,timestamptz,timestamptz,uuid[])
  to authenticated;

create function public.complete_card(target_card_id uuid, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare selected_card public.cards;
begin
  selected_card := public.lock_card_for_scheduling(target_card_id,expected_version);
  if selected_card.completed_at is null then
    update public.cards set completed_at = clock_timestamp() where id = target_card_id
      returning * into selected_card;
  end if;
  return jsonb_build_object('id',selected_card.id,'due_at',selected_card.due_at,
    'notify_at',selected_card.notify_at,'completed_at',selected_card.completed_at,
    'schedule_version',selected_card.schedule_version);
end;
$$;
revoke all on function public.complete_card(uuid,integer) from public, anon, authenticated;
grant execute on function public.complete_card(uuid,integer) to authenticated;

-- Solo estas RPC pueden cambiar responsables, fechas y finalización desde el cliente.
revoke insert, update on public.cards from public, anon, authenticated;
grant insert (id,board_id,list_id,title,description,position) on public.cards to authenticated;
grant update (title,description,list_id,position,archived_at) on public.cards to authenticated;
revoke insert, update, delete on public.card_assignees from public, anon, authenticated;
commit;
