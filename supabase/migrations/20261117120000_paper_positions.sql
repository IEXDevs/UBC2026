-- Paper positions and position-check snapshots.
-- Clients never use the service role. Authenticated JWT claims set app_owner_id().
-- Deny by default (RLS on); owner policies only. Service role bypasses RLS for the
-- Worker, which must filter by verified owner_id independently.

create table if not exists paper_positions (
  id text primary key,
  owner_id text not null references users(id),
  bot_id text not null references bots(id) on delete cascade,
  mint text not null,
  symbol text,
  kind text,
  decimals integer not null check (decimals >= 0 and decimals <= 18),
  quantity text not null check (quantity ~ '^(0|[1-9][0-9]{0,39})$'),
  entry_micro_usdc text not null check (entry_micro_usdc ~ '^(0|[1-9][0-9]{0,39})$'),
  realized_micro_usdc text not null default '0'
    check (realized_micro_usdc ~ '^-?(0|[1-9][0-9]{0,39})$'),
  status text not null check (status in ('open', 'closed')),
  mode text not null default 'paper' check (mode = 'paper'),
  cluster text not null default 'devnet' check (cluster in ('devnet', 'testnet')),
  opened_at bigint not null,
  updated_at bigint not null,
  label text not null default 'devnet execution, mainnet pricing',
  created_at timestamptz not null default now(),
  check (char_length(mint) between 32 and 64),
  check (char_length(id) between 1 and 160)
);

create table if not exists paper_fills (
  id text primary key,
  position_id text not null references paper_positions(id) on delete cascade,
  owner_id text not null references users(id),
  bot_id text not null references bots(id) on delete cascade,
  side text not null check (side in ('buy', 'sell')),
  mint text not null,
  symbol text,
  quantity text not null check (quantity ~ '^(0|[1-9][0-9]{0,39})$'),
  price_usd text,
  notional_micro_usdc text not null check (notional_micro_usdc ~ '^(0|[1-9][0-9]{0,39})$'),
  realized_micro_usdc text not null default '0'
    check (realized_micro_usdc ~ '^-?(0|[1-9][0-9]{0,39})$'),
  quote_source text,
  cluster text not null default 'devnet' check (cluster in ('devnet', 'testnet')),
  pricing_cluster text not null default 'mainnet' check (pricing_cluster = 'mainnet'),
  mode text not null default 'paper' check (mode = 'paper'),
  broadcast boolean not null default false check (broadcast = false),
  at bigint not null,
  created_at timestamptz not null default now(),
  check (char_length(id) between 1 and 160)
);

create table if not exists position_checks (
  id text primary key default ('pchk_' || gen_random_uuid()::text),
  owner_id text not null references users(id),
  bot_id text not null references bots(id) on delete cascade,
  at bigint not null,
  reason text not null check (reason in ('cron-hourly', 'stream-drop-recheck', 'owner')),
  status text not null,
  flag text not null,
  unrealized_loss_micro_usd text not null default '0'
    check (unrealized_loss_micro_usd ~ '^(0|[1-9][0-9]{0,39})$'),
  max_loss text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(status) between 1 and 64),
  check (char_length(flag) between 1 and 64)
);

create index if not exists paper_positions_owner_idx on paper_positions(owner_id);
create index if not exists paper_positions_bot_idx on paper_positions(bot_id);
create index if not exists paper_fills_owner_idx on paper_fills(owner_id);
create index if not exists paper_fills_position_idx on paper_fills(position_id);
create index if not exists position_checks_owner_idx on position_checks(owner_id, at desc);
create index if not exists position_checks_bot_idx on position_checks(bot_id, at desc);

alter table paper_positions enable row level security;
alter table paper_fills enable row level security;
alter table position_checks enable row level security;

-- No grants to anon. Authenticated gets table privileges; RLS still filters rows.
revoke all on table paper_positions from anon, public;
revoke all on table paper_fills from anon, public;
revoke all on table position_checks from anon, public;

grant select, insert, update, delete on table paper_positions to authenticated;
grant select, insert, update, delete on table paper_fills to authenticated;
grant select, insert, update, delete on table position_checks to authenticated;

-- Owner-only. Bot ownership must match the row owner (cannot reassign to another user).
create policy paper_positions_owner on paper_positions
  for all to authenticated
  using (
    owner_id = app_owner_id()
    and exists (
      select 1 from bots b
      where b.id = paper_positions.bot_id and b.owner_id = app_owner_id()
    )
  )
  with check (
    owner_id = app_owner_id()
    and exists (
      select 1 from bots b
      where b.id = paper_positions.bot_id and b.owner_id = app_owner_id()
    )
  );

create policy paper_fills_owner on paper_fills
  for all to authenticated
  using (
    owner_id = app_owner_id()
    and exists (
      select 1 from bots b
      where b.id = paper_fills.bot_id and b.owner_id = app_owner_id()
    )
  )
  with check (
    owner_id = app_owner_id()
    and exists (
      select 1 from bots b
      where b.id = paper_fills.bot_id and b.owner_id = app_owner_id()
    )
  );

create policy position_checks_owner on position_checks
  for all to authenticated
  using (
    owner_id = app_owner_id()
    and exists (
      select 1 from bots b
      where b.id = position_checks.bot_id and b.owner_id = app_owner_id()
    )
  )
  with check (
    owner_id = app_owner_id()
    and exists (
      select 1 from bots b
      where b.id = position_checks.bot_id and b.owner_id = app_owner_id()
    )
  );

-- Reuse activity-log redaction for check detail JSON when the helper exists.
create or replace function paper_positions_redact_check_detail()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    if to_regprocedure('redact_log_value(jsonb,integer)') is not null then
      new.detail := redact_log_value(coalesce(new.detail, '{}'::jsonb), 0);
    end if;
    if octet_length(coalesce(new.detail, '{}'::jsonb)::text) > 24000 then
      new.detail := '{"truncated":true,"paper":true}'::jsonb;
    end if;
    -- Authenticated clients cannot write another owner's row (defense in depth with RLS).
    if app_owner_id() is not null and new.owner_id is distinct from app_owner_id() then
      raise exception 'owner_mismatch' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists position_checks_redact on position_checks;
create trigger position_checks_redact
  before insert or update on position_checks
  for each row execute function paper_positions_redact_check_detail();

-- service_role already gets default privileges from 20261114190000; reinforce for new tables.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
grant all privileges on table paper_positions to service_role;
grant all privileges on table paper_fills to service_role;
grant all privileges on table position_checks to service_role;
