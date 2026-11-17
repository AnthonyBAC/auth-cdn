-- Durable handoff for REST's nontransactional destructive receive. No cron activation.
begin;
create table public.mq_rest_inbox (
  id uuid primary key default gen_random_uuid(),
  qmgr text not null check(length(qmgr) between 1 and 48),
  queue_name text not null check(length(queue_name) between 1 and 48),
  message_id text not null check(message_id ~ '^ID:[0-9A-Fa-f]{48}$'),
  body text not null, correlation_id text, reply_to text,
  state text not null default 'PENDING' check(state in ('PENDING','OUTPUT','DONE')),
  attempts integer not null default 0, output_attempts integer not null default 0,
  output jsonb, lock_token uuid, locked_until timestamptz,
  next_attempt_at timestamptz not null default now(), last_error text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique(qmgr,queue_name,message_id),
  check ((lock_token is null) = (locked_until is null)),
  check (state <> 'OUTPUT' or output is not null)
);
create index mq_rest_inbox_pending on public.mq_rest_inbox(qmgr,next_attempt_at) where state <> 'DONE';
alter table public.mq_rest_inbox enable row level security;
revoke all on public.mq_rest_inbox from public,anon,authenticated;
grant select on public.mq_rest_inbox to service_role;

create function public.mq_rest_capture(p_qmgr text,p_queue text,p_message_id text,p_body text,p_correlation_id text,p_reply_to text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_body text;
begin
  insert into mq_rest_inbox(qmgr,queue_name,message_id,body,correlation_id,reply_to)
    values(p_qmgr,p_queue,p_message_id,p_body,p_correlation_id,p_reply_to)
    on conflict(qmgr,queue_name,message_id) do nothing returning id into v_id;
  if v_id is null then
    select id,body into v_id,v_body from mq_rest_inbox
      where qmgr=p_qmgr and queue_name=p_queue and message_id=p_message_id;
    if v_body is distinct from p_body then raise exception 'MQ_MESSAGE_ID_COLLISION'; end if;
  end if;
  return v_id;
end;
$$;

create function public.mq_rest_claim(p_qmgr text,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r mq_rest_inbox; v_now timestamptz:=statement_timestamp();
begin
  select * into r from mq_rest_inbox where qmgr=p_qmgr and state <> 'DONE'
    and (p_id is null or id=p_id) and next_attempt_at<=v_now
    and (locked_until is null or locked_until<=v_now)
    order by next_attempt_at,created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  update mq_rest_inbox set lock_token=gen_random_uuid(),locked_until=v_now+interval '120 seconds',
    attempts=attempts+case when state='PENDING' then 1 else 0 end,
    output_attempts=output_attempts+case when state='OUTPUT' then 1 else 0 end
    where id=r.id returning * into r;
  return to_jsonb(r);
end;
$$;

create function public.mq_rest_update(p_id uuid,p_token uuid,p_action text,p_output jsonb default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r mq_rest_inbox; v_now timestamptz:=statement_timestamp();
begin
  select * into r from mq_rest_inbox where id=p_id for update;
  if not found or r.state='DONE' or r.lock_token is null or p_token is null
    or r.lock_token is distinct from p_token or r.locked_until<=v_now then return false; end if;
  if p_action='OUTPUT' then
    if r.state <> 'PENDING' or jsonb_typeof(p_output) is distinct from 'object'
      or not (p_output ? 'queue' and p_output ? 'body') then raise exception 'INVALID_OUTPUT'; end if;
    update mq_rest_inbox set state='OUTPUT',output=p_output,output_attempts=1 where id=p_id;
    -- Retain the lease to allow immediate dispatch of the persisted output.
  elsif p_action='DONE' then
    update mq_rest_inbox set state='DONE',completed_at=v_now,lock_token=null,locked_until=null,last_error=null where id=p_id;
  elsif p_action='RETRY' then
    update mq_rest_inbox set lock_token=null,locked_until=null,last_error='PROCESSING_OR_DELIVERY_UNCONFIRMED',
      next_attempt_at=v_now+make_interval(secs=>least(300,5*power(2,least(6,greatest(r.attempts,r.output_attempts)-1)))::integer) where id=p_id;
  else raise exception 'INVALID_ACTION'; end if;
  return true;
end;
$$;
revoke all on function public.mq_rest_capture(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.mq_rest_claim(text,uuid) from public,anon,authenticated;
revoke all on function public.mq_rest_update(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.mq_rest_capture(text,text,text,text,text,text) to service_role;
grant execute on function public.mq_rest_claim(text,uuid) to service_role;
grant execute on function public.mq_rest_update(uuid,uuid,text,jsonb) to service_role;
commit;
