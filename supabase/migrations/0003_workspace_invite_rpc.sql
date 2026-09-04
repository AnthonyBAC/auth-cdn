-- Fix: crear un workspace y su membresía owner de forma atómica.
-- El usuario aún no es miembro al crear el workspace, por lo que las políticas
-- RLS (SELECT de workspaces y INSERT de memberships) bloquean el flujo normal.
create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.workspaces (name)
  values (workspace_name)
  returning id into new_id;

  insert into public.memberships (workspace_id, user_id, role, status)
  values (new_id, auth.uid(), 'owner', 'active');

  return new_id;
end;
$$;

grant execute on function public.create_workspace(text) to authenticated;

-- Fix: aceptar una invitación de forma atómica.
-- El invitado no es owner, así que no puede leer invitations ni insertar memberships
-- bajo las políticas RLS actuales.
create or replace function public.accept_invitation(token_hash_input text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select * into inv
  from public.invitations
  where token_hash = token_hash_input
  limit 1;

  if inv is null
     or inv.accepted_at is not null
     or inv.revoked_at is not null
     or inv.expires_at < now() then
    return null;
  end if;

  if inv.email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Invitation belongs to another email' using errcode = '42501';
  end if;

  insert into public.memberships (workspace_id, user_id, role, status)
  values (inv.workspace_id, auth.uid(), inv.role, 'active')
  on conflict (workspace_id, user_id)
  do update set role = excluded.role, status = 'active', updated_at = now();

  update public.invitations
  set accepted_at = now()
  where id = inv.id;

  return inv.workspace_id;
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;
