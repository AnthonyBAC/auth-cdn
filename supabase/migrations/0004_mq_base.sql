-- Base de recordatorios. No publica mensajes ni inicia procesos de fondo.
-- Las migraciones anteriores permanecen intactas.
begin;

alter table public.cards
  add column due_at timestamptz,
  add column completed_at timestamptz,
  add column schedule_version integer not null default 1,
  add constraint cards_schedule_version_positive check (schedule_version > 0);

create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('TASK_REMINDER_DUE', 'TASK_OVERDUE')),
  schedule_version integer not null check (schedule_version > 0),
  due_at timestamptz not null,
  notify_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED', 'QUEUED', 'PROCESSED', 'CANCELLED', 'EXPIRED', 'FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint reminder_unique_schedule unique (card_id, schedule_version, kind, user_id),
  constraint reminder_expiration check (expires_at > notify_at),
  constraint reminder_time_by_kind check (
    (kind = 'TASK_REMINDER_DUE' and notify_at < due_at and expires_at <= due_at)
    or (kind = 'TASK_OVERDUE' and notify_at >= due_at)
  )
);

create table public.notification_outbox (
  event_id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null unique references public.task_reminders(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'EXPIRED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lock_token uuid,
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint outbox_lease check (
    (status = 'PROCESSING' and lock_token is not null and locked_until is not null)
    or (status <> 'PROCESSING' and lock_token is null and locked_until is null)
  ),
  constraint outbox_publication check ((status = 'PUBLISHED') = (published_at is not null))
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- Sin FK a outbox: limpiar publicaciones antiguas no borra notificaciones.
  event_id uuid not null,
  reminder_id uuid references public.task_reminders(id) on delete set null,
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_event_recipient unique (event_id, user_id)
);

create index reminders_due_idx on public.task_reminders(notify_at, id) where status = 'SCHEDULED';
create index reminders_recipient_idx on public.task_reminders(user_id, created_at desc);
create index outbox_pending_idx on public.notification_outbox(next_attempt_at, event_id) where status = 'PENDING';
create index outbox_lease_idx on public.notification_outbox(locked_until) where status = 'PROCESSING';
create index notifications_recipient_idx on public.notifications(user_id, created_at desc);
create index notifications_card_idx on public.notifications(card_id);
create index notifications_reminder_idx on public.notifications(reminder_id);

create trigger touch_task_reminders before update on public.task_reminders
  for each row execute function public.touch_updated_at();
create trigger touch_notification_outbox before update on public.notification_outbox
  for each row execute function public.touch_updated_at();
create trigger touch_notifications before update on public.notifications
  for each row execute function public.touch_updated_at();

alter table public.task_reminders enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notifications enable row level security;

-- Reutiliza la autorización del workspace; no agrega otro modelo de roles.
create policy "read own reminders in active workspace" on public.task_reminders
  for select to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.cards c
      join public.boards b on b.id = c.board_id
      join public.workspaces w on w.id = b.workspace_id
      where c.id = task_reminders.card_id and w.archived_at is null
        and public.can_read_workspace(w.id)
    )
  );

create policy "read own notifications in active workspace" on public.notifications
  for select to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.cards c
      join public.boards b on b.id = c.board_id
      join public.workspaces w on w.id = b.workspace_id
      where c.id = notifications.card_id and w.archived_at is null
        and public.can_read_workspace(w.id)
    )
  );

-- La política limita filas; el GRANT inferior limita la columna modificable.
create policy "mark own notifications read" on public.notifications
  for update to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.cards c
      join public.boards b on b.id = c.board_id
      join public.workspaces w on w.id = b.workspace_id
      where c.id = notifications.card_id and w.archived_at is null
        and public.can_read_workspace(w.id)
    )
  ) with check (user_id = auth.uid());

-- No depender de los privilegios por defecto del proyecto Supabase.
revoke all on public.task_reminders, public.notification_outbox, public.notifications
  from public, anon, authenticated;
grant select on public.task_reminders, public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.task_reminders, public.notification_outbox, public.notifications to service_role;

-- Las escrituras de recordatorios/outbox quedan cerradas al navegador.
-- El siguiente paso incorporará operaciones atómicas con autorización explícita.
commit;
