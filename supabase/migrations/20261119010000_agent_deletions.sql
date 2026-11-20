create table if not exists public.deleted_agents (
  owner_id text not null references public.users(id) on delete cascade,
  bot_id text not null check (bot_id ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  primary key (owner_id, bot_id)
);

alter table public.deleted_agents enable row level security;
alter table public.deleted_agents force row level security;
revoke all on table public.deleted_agents from public, anon, authenticated;
grant select, insert on table public.deleted_agents to service_role;

create or replace function public.enforce_agent_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then
      raise unique_violation using message = 'agent identity cannot change';
    end if;
    return new;
  end if;

  -- Serialize creation (including upserts) with deletion for this agent ID.
  perform pg_advisory_xact_lock(hashtextextended(new.id, 0));
  if exists (
    select 1 from public.deleted_agents where owner_id = new.owner_id and bot_id = new.id
  ) then
    raise sqlstate 'PT410' using message = 'agent_deleted';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_agent_identity on public.bots;
create trigger enforce_agent_identity before insert or update of id, owner_id on public.bots
for each row execute function public.enforce_agent_identity();

create or replace function public.delete_owner_agent(p_owner_id text, p_bot_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bot_id, 0));

  -- An agent created on the desk can be deleted before it has a bots row.
  insert into public.users (id, privy_user_id) values (p_owner_id, p_owner_id)
  on conflict (id) do nothing;
  insert into public.deleted_agents (owner_id, bot_id) values (p_owner_id, p_bot_id)
  on conflict do nothing;

  perform 1 from public.bots where id = p_bot_id and owner_id = p_owner_id for update;
  if not found then
    return;
  end if;

  delete from public.budget_reservations where bot_id = p_bot_id;
  delete from public.spend_ledgers where bot_id = p_bot_id;
  delete from public.approvals where bot_id = p_bot_id;
  delete from public.decision_records where bot_id = p_bot_id;
  delete from public.timeline_events where bot_id = p_bot_id;
  delete from public.payments where bot_id = p_bot_id;
  delete from public.metrics where bot_id = p_bot_id;
  delete from public.stream_events where bot_id = p_bot_id;
  delete from public.activity_logs where owner_id = p_owner_id and bot_id = p_bot_id;
  delete from public.bots where id = p_bot_id and owner_id = p_owner_id;
end;
$$;

create or replace function public.list_deleted_owner_agents(p_owner_id text)
returns table(ids text[])
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(bot_id), array[]::text[])
  from public.deleted_agents
  where owner_id = p_owner_id;
$$;

revoke all on function public.enforce_agent_identity() from public, anon, authenticated;
revoke all on function public.delete_owner_agent(text, text) from public, anon, authenticated;
revoke all on function public.list_deleted_owner_agents(text) from public, anon, authenticated;
grant execute on function public.delete_owner_agent(text, text) to service_role;
grant execute on function public.list_deleted_owner_agents(text) to service_role;
