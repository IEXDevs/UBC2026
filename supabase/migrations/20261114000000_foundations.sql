-- Maelstrom / UBC2026 Supabase schema (Postgres)
-- Keys stay in Privy; this DB holds assignments, ledgers, and audit records.
-- Apply this file, or the identical copy in supabase/migrations/.

create extension if not exists "pgcrypto";

-- Dashboard clients pass owner_id or sub in the JWT. Service role bypasses RLS.
create or replace function app_owner_id()
returns text
language plpgsql
stable
as $$
declare
  claims json;
  owner text;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::json;
  exception when others then
    claims := null;
  end;
  if claims is not null then
    owner := nullif(claims->>'owner_id', '');
    if owner is not null then
      return owner;
    end if;
    owner := nullif(claims->>'sub', '');
    if owner is not null then
      return owner;
    end if;
  end if;
  begin
    execute 'select auth.uid()::text' into owner;
    return nullif(owner, '');
  exception when others then
    return null;
  end;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create table if not exists users (
  id text primary key,
  privy_user_id text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists wallets (
  id text primary key,
  owner_id text not null references users(id),
  kind text not null check (kind in ('main', 'additional')),
  label text not null check (char_length(label) between 1 and 64),
  address text not null,
  provider text not null default 'privy' check (provider = 'privy'),
  frozen boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, address)
);

create unique index if not exists wallets_one_main_per_owner
  on wallets (owner_id) where kind = 'main';

create table if not exists bots (
  id text primary key,
  owner_id text not null references users(id),
  wallet_id text not null references wallets(id),
  name text not null,
  goal text not null,
  type text not null check (type in ('trading', 'shopping', 'position-management')),
  approval_mode text not null check (approval_mode in ('fully-automatic', 'capped-automatic', 'ask')),
  auto_approve_cap numeric,
  template_id text,
  enabled boolean not null default true,
  frozen boolean not null default false,
  policy_version integer not null default 1 check (policy_version >= 1),
  cap_mode text not null check (cap_mode in ('limited', 'unlimited')),
  cap_asset text not null,
  max_outflow numeric,
  max_per_transaction numeric,
  max_loss numeric,
  created_at timestamptz not null default now()
);

-- One wallet per bot. Several bots may share a wallet (wallets are not unique here).
create or replace view bot_assignments
with (security_invoker = true) as
select
  b.id as bot_id,
  b.owner_id,
  b.wallet_id,
  w.kind as wallet_kind,
  w.address,
  w.frozen as wallet_frozen,
  b.type as bot_type,
  b.approval_mode,
  b.cap_mode,
  b.cap_asset,
  b.max_outflow,
  b.max_per_transaction,
  b.max_loss
from bots b
join wallets w on w.id = b.wallet_id;

create table if not exists spend_ledgers (
  bot_id text primary key references bots(id),
  asset text not null,
  spent numeric not null default 0 check (spent >= 0),
  reserved numeric not null default 0 check (reserved >= 0),
  realized_loss numeric not null default 0 check (realized_loss >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists approvals (
  id text primary key,
  owner_id text not null references users(id),
  bot_id text not null references bots(id),
  digest text not null,
  policy_version integer not null,
  action text not null check (action in ('approve', 'approve-once', 'raise-limit')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists decision_records (
  id text primary key,
  bot_id text not null references bots(id),
  run_id text not null,
  cluster text not null check (cluster in ('devnet', 'testnet')),
  facts_digest text not null,
  proposal_digest text not null,
  status text not null check (status in ('pending', 'approved', 'executed', 'rejected', 'mismatch')),
  memo_signature text,
  created_at timestamptz not null default now()
);

create table if not exists timeline_events (
  id text primary key,
  bot_id text not null references bots(id),
  owner_id text not null references users(id),
  kind text not null,
  summary text not null,
  prev_hash text,
  at timestamptz not null default now()
);

create table if not exists payments (
  id text primary key,
  bot_id text not null references bots(id),
  direction text not null check (direction in ('paid', 'earned')),
  protocol text not null default 'x402',
  amount numeric not null,
  asset text not null,
  counterparty text,
  cluster text not null check (cluster in ('devnet', 'testnet')),
  tx_signature text,
  created_at timestamptz not null default now()
);

-- Per-bot counters, plus one owner rollup row where bot_id is null.
create table if not exists metrics (
  id text primary key,
  owner_id text not null references users(id),
  bot_id text references bots(id),
  decisions integer not null default 0 check (decisions >= 0),
  transactions_executed integer not null default 0 check (transactions_executed >= 0),
  mismatches_caught integer not null default 0 check (mismatches_caught >= 0),
  transactions_blocked integer not null default 0 check (transactions_blocked >= 0),
  approvals_requested integer not null default 0 check (approvals_requested >= 0),
  approvals_granted integer not null default 0 check (approvals_granted >= 0),
  x402_payments integer not null default 0 check (x402_payments >= 0),
  pnl_micro_usdc numeric not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists metrics_owner_bot_uidx
  on metrics (owner_id, bot_id) where bot_id is not null;
create unique index if not exists metrics_owner_rollup_uidx
  on metrics (owner_id) where bot_id is null;

create index if not exists bots_owner_idx on bots(owner_id);
create index if not exists bots_wallet_idx on bots(wallet_id);
create index if not exists timeline_bot_at_idx on timeline_events(bot_id, at desc);
create index if not exists payments_bot_idx on payments(bot_id, created_at desc);
create index if not exists metrics_owner_idx on metrics(owner_id);

alter table users enable row level security;
alter table wallets enable row level security;
alter table bots enable row level security;
alter table spend_ledgers enable row level security;
alter table approvals enable row level security;
alter table decision_records enable row level security;
alter table timeline_events enable row level security;
alter table payments enable row level security;
alter table metrics enable row level security;

drop policy if exists users_owner on users;
create policy users_owner on users
  for all to authenticated
  using (id = app_owner_id() or privy_user_id = app_owner_id())
  with check (id = app_owner_id() or privy_user_id = app_owner_id());

drop policy if exists wallets_owner on wallets;
create policy wallets_owner on wallets
  for all to authenticated
  using (owner_id = app_owner_id())
  with check (owner_id = app_owner_id());

drop policy if exists bots_owner on bots;
create policy bots_owner on bots
  for all to authenticated
  using (owner_id = app_owner_id())
  with check (owner_id = app_owner_id());

drop policy if exists spend_ledgers_owner on spend_ledgers;
create policy spend_ledgers_owner on spend_ledgers
  for all to authenticated
  using (exists (
    select 1 from bots b where b.id = spend_ledgers.bot_id and b.owner_id = app_owner_id()
  ))
  with check (exists (
    select 1 from bots b where b.id = spend_ledgers.bot_id and b.owner_id = app_owner_id()
  ));

drop policy if exists approvals_owner on approvals;
create policy approvals_owner on approvals
  for all to authenticated
  using (owner_id = app_owner_id())
  with check (owner_id = app_owner_id());

drop policy if exists decision_records_owner on decision_records;
create policy decision_records_owner on decision_records
  for all to authenticated
  using (exists (
    select 1 from bots b where b.id = decision_records.bot_id and b.owner_id = app_owner_id()
  ))
  with check (exists (
    select 1 from bots b where b.id = decision_records.bot_id and b.owner_id = app_owner_id()
  ));

drop policy if exists timeline_events_owner on timeline_events;
create policy timeline_events_owner on timeline_events
  for all to authenticated
  using (owner_id = app_owner_id())
  with check (owner_id = app_owner_id());

drop policy if exists payments_owner on payments;
create policy payments_owner on payments
  for all to authenticated
  using (exists (
    select 1 from bots b where b.id = payments.bot_id and b.owner_id = app_owner_id()
  ))
  with check (exists (
    select 1 from bots b where b.id = payments.bot_id and b.owner_id = app_owner_id()
  ));

drop policy if exists metrics_owner on metrics;
create policy metrics_owner on metrics
  for all to authenticated
  using (owner_id = app_owner_id())
  with check (owner_id = app_owner_id());

grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Realtime on the dashboard tables. Supabase already has this publication;
-- a bare Postgres database gets one created here.
do $$
declare
  tbl text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach tbl in array array[
    'wallets',
    'bots',
    'spend_ledgers',
    'approvals',
    'decision_records',
    'timeline_events',
    'payments',
    'metrics'
  ]
  loop
    execute format('alter table %I replica identity full', tbl);
    begin
      execute format('alter publication supabase_realtime add table %I', tbl);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;
