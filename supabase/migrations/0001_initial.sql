create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  location_name text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create type public.workspace_role as enum ('owner', 'editor', 'viewer');
create type public.membership_status as enum ('invited', 'active', 'removed');

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 100),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 100),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 10000),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.card_assignees (
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);

create table public.context_snapshots (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create index memberships_user_idx on public.memberships(user_id, status);
create index boards_workspace_idx on public.boards(workspace_id, archived_at, position);
create index lists_board_idx on public.lists(board_id, archived_at, position);
create index cards_list_idx on public.cards(list_id, archived_at, position);
create index cards_board_idx on public.cards(board_id, archived_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger touch_workspaces before update on public.workspaces for each row execute function public.touch_updated_at();
create trigger touch_memberships before update on public.memberships for each row execute function public.touch_updated_at();
create trigger touch_boards before update on public.boards for each row execute function public.touch_updated_at();
create trigger touch_lists before update on public.lists for each row execute function public.touch_updated_at();
create trigger touch_cards before update on public.cards for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_id uuid;
  display_name text;
begin
  display_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  insert into public.profiles (id, email, name)
  values (new.id, lower(new.email), display_name);

  insert into public.workspaces (name)
  values (display_name || '''s Workspace')
  returning id into workspace_id;

  insert into public.memberships (workspace_id, user_id, role, status)
  values (workspace_id, new.id, 'owner', 'active');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.active_role(target_workspace uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.memberships
  where workspace_id = target_workspace
    and user_id = auth.uid()
    and status = 'active'
  limit 1
$$;

create or replace function public.can_read_workspace(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.active_role(target_workspace) is not null
$$;

create or replace function public.can_edit_workspace_content(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.active_role(target_workspace) in ('owner', 'editor')
$$;

create or replace function public.can_manage_workspace(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.active_role(target_workspace) = 'owner'
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.boards enable row level security;
alter table public.lists enable row level security;
alter table public.cards enable row level security;
alter table public.card_assignees enable row level security;
alter table public.context_snapshots enable row level security;

create policy "read own profile" on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.memberships mine
    join public.memberships theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = profiles.id and theirs.status = 'active'
  )
);
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "read member workspaces" on public.workspaces for select using (public.can_read_workspace(id));
create policy "create own workspaces" on public.workspaces for insert with check (auth.uid() is not null);
create policy "owner updates workspaces" on public.workspaces for update using (public.can_manage_workspace(id)) with check (public.can_manage_workspace(id));

create policy "read memberships in workspace" on public.memberships for select using (public.can_read_workspace(workspace_id));
create policy "owner creates memberships" on public.memberships for insert with check (public.can_manage_workspace(workspace_id));
create policy "owner updates memberships" on public.memberships for update using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));

create policy "read invitations in workspace" on public.invitations for select using (public.can_manage_workspace(workspace_id));
create policy "owner creates invitations" on public.invitations for insert with check (public.can_manage_workspace(workspace_id));
create policy "owner updates invitations" on public.invitations for update using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));

create policy "read boards" on public.boards for select using (public.can_read_workspace(workspace_id));
create policy "edit boards" on public.boards for all using (public.can_edit_workspace_content(workspace_id)) with check (public.can_edit_workspace_content(workspace_id));

create policy "read lists" on public.lists for select using (
  exists (select 1 from public.boards where boards.id = lists.board_id and public.can_read_workspace(boards.workspace_id))
);
create policy "edit lists" on public.lists for all using (
  exists (select 1 from public.boards where boards.id = lists.board_id and public.can_edit_workspace_content(boards.workspace_id))
) with check (
  exists (select 1 from public.boards where boards.id = lists.board_id and public.can_edit_workspace_content(boards.workspace_id))
);

create policy "read cards" on public.cards for select using (
  exists (select 1 from public.boards where boards.id = cards.board_id and public.can_read_workspace(boards.workspace_id))
);
create policy "edit cards" on public.cards for all using (
  exists (select 1 from public.boards where boards.id = cards.board_id and public.can_edit_workspace_content(boards.workspace_id))
) with check (
  exists (select 1 from public.boards where boards.id = cards.board_id and public.can_edit_workspace_content(boards.workspace_id))
);

create policy "read assignees" on public.card_assignees for select using (
  exists (
    select 1 from public.cards
    join public.boards on boards.id = cards.board_id
    where cards.id = card_assignees.card_id and public.can_read_workspace(boards.workspace_id)
  )
);
create policy "edit assignees" on public.card_assignees for all using (
  exists (
    select 1 from public.cards
    join public.boards on boards.id = cards.board_id
    where cards.id = card_assignees.card_id and public.can_edit_workspace_content(boards.workspace_id)
  )
) with check (
  exists (
    select 1 from public.cards
    join public.boards on boards.id = cards.board_id
    where cards.id = card_assignees.card_id and public.can_edit_workspace_content(boards.workspace_id)
  )
);

create policy "read context" on public.context_snapshots for select using (public.can_read_workspace(workspace_id));
create policy "owner writes context" on public.context_snapshots for all using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));
