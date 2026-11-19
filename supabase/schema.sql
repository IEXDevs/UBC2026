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
  deleted_at timestamptz,
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
-- Policy ledger (chunk 2A): atomic budget reserve, approval modes, and the kill switch.
-- Authenticated sessions can read. They cannot zero `reserved`, forge an approval,
-- or clear a pause/freeze. Those writes go through the security-definer functions.
-- No credentials are stored here. Service role inserts users, wallets, and bots.

create table if not exists budget_reservations (
  idempotency_key text primary key check (idempotency_key ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  bot_id text not null references bots(id),
  owner_id text not null references users(id),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  debit numeric not null check (debit >= 0 and debit = trunc(debit)),
  approval_id text references approvals(id),
  status text not null check (status in ('reserved', 'spent', 'released')),
  created_at timestamptz not null default now()
);

create index if not exists budget_reservations_bot_idx on budget_reservations(bot_id);

alter table bots drop constraint if exists bots_cap_amounts_check;
alter table bots add constraint bots_cap_amounts_check check (
  cap_mode = 'unlimited'
  or (
    type = 'position-management'
    and max_loss is not null
    and max_loss >= 0
    and max_loss = trunc(max_loss)
  )
  or (
    type in ('trading', 'shopping')
    and max_outflow is not null
    and max_per_transaction is not null
    and max_outflow >= 0
    and max_per_transaction >= 0
    and max_outflow = trunc(max_outflow)
    and max_per_transaction = trunc(max_per_transaction)
  )
);

alter table bots drop constraint if exists bots_auto_approve_cap_check;
alter table bots add constraint bots_auto_approve_cap_check check (
  (
    approval_mode = 'capped-automatic'
    and auto_approve_cap is not null
    and auto_approve_cap >= 0
    and auto_approve_cap = trunc(auto_approve_cap)
  )
  or (
    approval_mode <> 'capped-automatic'
    and auto_approve_cap is null
  )
);

alter table budget_reservations enable row level security;

drop policy if exists spend_ledgers_owner on spend_ledgers;
create policy spend_ledgers_owner_read on spend_ledgers
  for select to authenticated
  using (exists (
    select 1 from bots b where b.id = spend_ledgers.bot_id and b.owner_id = app_owner_id()
  ));

drop policy if exists approvals_owner on approvals;
create policy approvals_owner_read on approvals
  for select to authenticated
  using (owner_id = app_owner_id());

drop policy if exists timeline_events_owner on timeline_events;
create policy timeline_events_owner_read on timeline_events
  for select to authenticated
  using (owner_id = app_owner_id());

drop policy if exists bots_owner on bots;
create policy bots_owner_read on bots
  for select to authenticated
  using (owner_id = app_owner_id());

drop policy if exists wallets_owner on wallets;
create policy wallets_owner_read on wallets
  for select to authenticated
  using (owner_id = app_owner_id());

drop policy if exists budget_reservations_owner_read on budget_reservations;
create policy budget_reservations_owner_read on budget_reservations
  for select to authenticated
  using (owner_id = app_owner_id());

revoke insert, update, delete on spend_ledgers from anon, authenticated;
revoke insert, update, delete on approvals from anon, authenticated;
revoke insert, update, delete on timeline_events from anon, authenticated;
revoke insert, update, delete on bots from anon, authenticated;
revoke insert, update, delete on wallets from anon, authenticated;
revoke all on budget_reservations from anon, public;
grant select on budget_reservations to authenticated;

create or replace function policy_amount(raw text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
begin
  if raw is null or raw !~ '^(0|[1-9][0-9]{0,39})$' then
    raise exception 'Amounts must be unsigned integer strings in base units';
  end if;
  return raw::numeric;
end;
$$;

create or replace function policy_int_text(amount numeric)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if amount is null or amount < 0 or amount <> trunc(amount) then
    raise exception 'Amounts must be unsigned integer strings in base units';
  end if;
  return trunc(amount)::text;
end;
$$;

create or replace function policy_sha256_hex(payload text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  bytes bytea;
begin
  begin
    execute 'select public.digest($1, ''sha256'')' into bytes using convert_to(payload, 'UTF8');
  exception when undefined_function or invalid_schema_name then
    execute 'select extensions.digest($1, ''sha256'')' into bytes using convert_to(payload, 'UTF8');
  end;
  return encode(bytes, 'hex');
end;
$$;

create or replace function policy_assert_actor(claimed text)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  actor text := app_owner_id();
begin
  if claimed is null or claimed !~ '^[a-zA-Z0-9:_-]{1,128}$' then
    raise exception 'ownerId is required';
  end if;
  if actor is not null and actor is distinct from claimed then
    raise exception 'forbidden';
  end if;
end;
$$;

create or replace function policy_assert_time(payload jsonb)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
declare
  raw text := payload->>'now';
begin
  if raw is null or raw !~ '^(0|[1-9][0-9]{0,15})$' or raw::numeric > 9007199254740991 then
    raise exception 'Explicit server time is required';
  end if;
  return to_timestamp(raw::numeric / 1000.0);
end;
$$;

create or replace function policy_assert_proposal(proposal jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if proposal is null
     or coalesce(char_length(proposal->>'id'), 0) = 0 or char_length(proposal->>'id') > 256
     or coalesce(char_length(proposal->>'botId'), 0) = 0 or char_length(proposal->>'botId') > 256
     or coalesce(char_length(proposal->>'asset'), 0) = 0 or char_length(proposal->>'asset') > 256
     or coalesce(char_length(proposal->>'recipient'), 0) = 0 or char_length(proposal->>'recipient') > 256
     or coalesce(char_length(proposal->>'quoteId'), 0) = 0 or char_length(proposal->>'quoteId') > 256
     or coalesce(char_length(proposal->>'expectedReceiveAsset'), 0) = 0 or char_length(proposal->>'expectedReceiveAsset') > 256
  then
    raise exception 'Incomplete transaction preview';
  end if;
  if proposal->>'cluster' is null or proposal->>'cluster' not in ('devnet', 'testnet') then
    raise exception 'Hackathon execution must use devnet or testnet';
  end if;
  perform policy_amount(proposal->>'outflow');
  perform policy_amount(proposal->>'expectedReceive');
  perform policy_amount(proposal->>'maxFee');
  if proposal->>'expiresAt' is null
     or proposal->>'expiresAt' !~ '^[1-9][0-9]{0,15}$'
     or (proposal->>'expiresAt')::numeric > 9007199254740991
  then
    raise exception 'Invalid quote expiry';
  end if;
end;
$$;

create or replace function policy_proposal_digest(proposal jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  canonical text;
begin
  perform policy_assert_proposal(proposal);
  canonical := '{'
    || '"id":' || to_json(proposal->>'id')
    || ',"botId":' || to_json(proposal->>'botId')
    || ',"cluster":' || to_json(proposal->>'cluster')
    || ',"asset":' || to_json(proposal->>'asset')
    || ',"recipient":' || to_json(proposal->>'recipient')
    || ',"quoteId":' || to_json(proposal->>'quoteId')
    || ',"outflow":' || to_json(proposal->>'outflow')
    || ',"expectedReceive":' || to_json(proposal->>'expectedReceive')
    || ',"expectedReceiveAsset":' || to_json(proposal->>'expectedReceiveAsset')
    || ',"maxFee":' || to_json(proposal->>'maxFee')
    || ',"expiresAt":' || (proposal->>'expiresAt')
    || '}';
  return policy_sha256_hex(canonical);
end;
$$;

create or replace function policy_timeline(
  p_bot_id text,
  p_owner_id text,
  p_kind text,
  p_summary text,
  p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into timeline_events (id, bot_id, owner_id, kind, summary, at)
  values (
    'evt_' || replace(gen_random_uuid()::text, '-', ''),
    p_bot_id,
    p_owner_id,
    p_kind,
    left(p_summary, 500),
    p_at
  );
end;
$$;

create or replace function policy_assess_spend(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed text := payload->>'ownerId';
  now_ms numeric;
  proposal jsonb := payload->'proposal';
  bot bots%rowtype;
  wallet wallets%rowtype;
  ledger spend_ledgers%rowtype;
  approval approvals%rowtype;
  approval_id text := nullif(payload->>'approvalId', '');
  debit numeric;
  digest text;
  violations jsonb := '[]'::jsonb;
  mode text;
  needs_approval boolean;
  expires_ms numeric;
begin
  perform policy_assert_actor(claimed);
  perform policy_assert_time(payload);
  now_ms := (payload->>'now')::numeric;
  perform policy_assert_proposal(proposal);
  debit := policy_amount(proposal->>'outflow') + policy_amount(proposal->>'maxFee');
  digest := policy_proposal_digest(proposal);
  expires_ms := (proposal->>'expiresAt')::numeric;

  select * into bot from bots where id = proposal->>'botId';
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'bot-missing');
  end if;
  if claimed is distinct from bot.owner_id then
    return jsonb_build_object('state', 'blocked', 'reason', 'wrong-owner');
  end if;

  select * into wallet from wallets where id = bot.wallet_id;
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'wallet-missing');
  end if;
  if wallet.owner_id is distinct from bot.owner_id then
    return jsonb_build_object('state', 'blocked', 'reason', 'wallet-owner-mismatch');
  end if;
  if wallet.frozen then
    return jsonb_build_object('state', 'blocked', 'reason', 'wallet-frozen');
  end if;
  if bot.frozen then
    return jsonb_build_object('state', 'blocked', 'reason', 'bot-frozen');
  end if;

  select * into ledger from spend_ledgers s where s.bot_id = bot.id;
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'ledger-missing');
  end if;
  if ledger.asset is distinct from bot.cap_asset then
    raise exception 'Matching budget ledger is required';
  end if;

  mode := bot.approval_mode;
  if mode is null or mode not in ('ask', 'fully-automatic', 'capped-automatic') then
    raise exception 'Unknown approval mode';
  end if;
  if mode = 'capped-automatic' then
    if bot.auto_approve_cap is null then
      raise exception 'Amounts must be unsigned integer strings in base units';
    end if;
    perform policy_int_text(bot.auto_approve_cap);
  end if;

  if not bot.enabled then
    return jsonb_build_object('state', 'blocked', 'reason', 'bot-disabled');
  end if;
  if expires_ms <= now_ms then
    return jsonb_build_object('state', 'blocked', 'reason', 'quote-expired');
  end if;
  if proposal->>'asset' is distinct from bot.cap_asset then
    return jsonb_build_object('state', 'blocked', 'reason', 'accounting-asset-mismatch');
  end if;

  if bot.cap_mode = 'limited' and bot.type = 'position-management' then
    if bot.max_loss is null then
      raise exception 'Amounts must be unsigned integer strings in base units';
    end if;
    if ledger.realized_loss >= bot.max_loss then
      return jsonb_build_object('state', 'blocked', 'reason', 'max-loss-reached');
    end if;
  elsif bot.cap_mode = 'limited' then
    if bot.max_outflow is null or bot.max_per_transaction is null then
      raise exception 'Amounts must be unsigned integer strings in base units';
    end if;
    if debit > bot.max_per_transaction then
      violations := violations || jsonb_build_array('per-transaction');
    end if;
    if ledger.spent + ledger.reserved + debit > bot.max_outflow then
      violations := violations || jsonb_build_array('total-outflow');
    end if;
  elsif bot.cap_mode is distinct from 'unlimited' then
    raise exception 'Explicit cap choice and accounting asset are required';
  end if;

  needs_approval := jsonb_array_length(violations) > 0 or mode = 'ask';
  if mode = 'capped-automatic' and debit > bot.auto_approve_cap then
    needs_approval := true;
  end if;

  if needs_approval and approval_id is null then
    if jsonb_array_length(violations) > 0 then
      return jsonb_build_object(
        'state', 'over-budget',
        'violations', violations,
        'actions', jsonb_build_array('approve-once', 'raise-limit'),
        'digest', digest,
        'debit', policy_int_text(debit)
      );
    end if;
    return jsonb_build_object(
      'state', 'approval-needed',
      'violations', violations,
      'actions', jsonb_build_array('approve'),
      'digest', digest,
      'debit', policy_int_text(debit)
    );
  end if;

  if approval_id is not null then
    select * into approval from approvals where id = approval_id;
    if not found
       or approval.owner_id is distinct from bot.owner_id
       or approval.bot_id is distinct from bot.id
       or approval.policy_version is distinct from bot.policy_version
       or approval.digest is distinct from digest
       or approval.used_at is not null
       or approval.action not in ('approve', 'approve-once')
       or approval.expires_at <= to_timestamp(now_ms / 1000.0)
       or approval.expires_at > to_timestamp(expires_ms / 1000.0)
    then
      return jsonb_build_object('state', 'blocked', 'reason', 'invalid-approval');
    end if;
    if jsonb_array_length(violations) > 0 and approval.action is distinct from 'approve-once' then
      return jsonb_build_object('state', 'blocked', 'reason', 'budget-override-required');
    end if;
  end if;

  return jsonb_build_object(
    'state', 'ready-to-reserve',
    'digest', digest,
    'debit', policy_int_text(debit),
    'approvalMode', mode
  );
end;
$$;

create or replace function policy_reserve_budget(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idem text := payload->>'idempotencyKey';
  proposal jsonb := payload->'proposal';
  v_bot_id text;
  v_wallet_id text;
  v_digest text;
  existing budget_reservations%rowtype;
  decision jsonb;
  v_debit numeric;
  v_approval_id text := nullif(payload->>'approvalId', '');
  p_now timestamptz;
  v_ledger spend_ledgers%rowtype;
begin
  if v_idem is null or v_idem !~ '^[a-zA-Z0-9:_-]{1,128}$' then
    raise exception 'idempotency key is required';
  end if;
  perform policy_assert_actor(payload->>'ownerId');
  p_now := policy_assert_time(payload);
  perform policy_assert_proposal(proposal);
  v_bot_id := proposal->>'botId';
  v_digest := policy_proposal_digest(proposal);

  perform pg_advisory_xact_lock(hashtextextended(v_idem, 0));
  select * into existing from budget_reservations where idempotency_key = v_idem for update;
  if found then
    if existing.digest is distinct from v_digest or existing.bot_id is distinct from v_bot_id then
      raise exception 'idempotency-mismatch';
    end if;
    select * into v_ledger from spend_ledgers s where s.bot_id = existing.bot_id;
    return jsonb_build_object(
      'state', 'reserved',
      'replay', true,
      'debit', policy_int_text(existing.debit),
      'digest', existing.digest,
      'reservation', jsonb_build_object(
        'idempotencyKey', existing.idempotency_key,
        'botId', existing.bot_id,
        'ownerId', existing.owner_id,
        'digest', existing.digest,
        'debit', policy_int_text(existing.debit),
        'approvalId', existing.approval_id,
        'status', existing.status
      ),
      'ledger', jsonb_build_object(
        'botId', v_ledger.bot_id,
        'asset', v_ledger.asset,
        'spent', policy_int_text(v_ledger.spent),
        'reserved', policy_int_text(v_ledger.reserved),
        'realizedLoss', policy_int_text(v_ledger.realized_loss)
      )
    );
  end if;

  select b.wallet_id into v_wallet_id from bots b where b.id = v_bot_id;
  if v_wallet_id is not null then
    perform 1 from wallets w where w.id = v_wallet_id for update;
  end if;
  perform 1 from bots b where b.id = v_bot_id for update;
  perform 1 from spend_ledgers s where s.bot_id = v_bot_id for update;
  if v_approval_id is not null then
    perform 1 from approvals a where a.id = v_approval_id for update;
  end if;

  decision := policy_assess_spend(payload);
  if decision->>'state' is distinct from 'ready-to-reserve' then
    return decision || jsonb_build_object('replay', false);
  end if;

  v_debit := policy_amount(decision->>'debit');
  update spend_ledgers s
     set reserved = s.reserved + v_debit,
         updated_at = p_now
   where s.bot_id = v_bot_id
   returning * into v_ledger;

  if v_approval_id is not null then
    update approvals a set used_at = p_now where a.id = v_approval_id and a.used_at is null;
    if not found then
      raise exception 'invalid-approval';
    end if;
  end if;

  insert into budget_reservations (
    idempotency_key, bot_id, owner_id, digest, debit, approval_id, status, created_at
  ) values (
    v_idem, v_bot_id, payload->>'ownerId', decision->>'digest', v_debit, v_approval_id, 'reserved', p_now
  );

  perform policy_timeline(
    v_bot_id,
    payload->>'ownerId',
    'budget.reserved',
    'Reserved ' || (decision->>'debit') || ' ' || (proposal->>'asset'),
    p_now
  );

  return decision || jsonb_build_object(
    'state', 'reserved',
    'replay', false,
    'reservation', jsonb_build_object(
      'idempotencyKey', v_idem,
      'botId', v_bot_id,
      'ownerId', payload->>'ownerId',
      'digest', decision->>'digest',
      'debit', decision->>'debit',
      'approvalId', v_approval_id,
      'status', 'reserved'
    ),
    'ledger', jsonb_build_object(
      'botId', v_ledger.bot_id,
      'asset', v_ledger.asset,
      'spent', policy_int_text(v_ledger.spent),
      'reserved', policy_int_text(v_ledger.reserved),
      'realizedLoss', policy_int_text(v_ledger.realized_loss)
    )
  );
end;
$$;

create or replace function policy_pause_bot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bot bots%rowtype;
  p_now timestamptz;
begin
  perform policy_assert_actor(payload->>'ownerId');
  p_now := policy_assert_time(payload);
  select * into bot from bots where id = payload->>'botId' for update;
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'bot-missing');
  end if;
  if bot.owner_id is distinct from payload->>'ownerId' then
    return jsonb_build_object('state', 'blocked', 'reason', 'wrong-owner');
  end if;
  if not bot.enabled then
    return jsonb_build_object('state', 'paused', 'botId', bot.id, 'enabled', false, 'frozen', bot.frozen, 'changed', false);
  end if;
  update bots set enabled = false where id = bot.id;
  perform policy_timeline(bot.id, bot.owner_id, 'bot.paused', 'Paused bot', p_now);
  return jsonb_build_object('state', 'paused', 'botId', bot.id, 'enabled', false, 'frozen', bot.frozen, 'changed', true);
end;
$$;

create or replace function policy_resume_bot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bot bots%rowtype;
  p_now timestamptz;
begin
  perform policy_assert_actor(payload->>'ownerId');
  p_now := policy_assert_time(payload);
  select * into bot from bots where id = payload->>'botId' for update;
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'bot-missing');
  end if;
  if bot.owner_id is distinct from payload->>'ownerId' then
    return jsonb_build_object('state', 'blocked', 'reason', 'wrong-owner');
  end if;
  if bot.frozen then
    return jsonb_build_object('state', 'blocked', 'reason', 'bot-frozen');
  end if;
  if bot.enabled then
    return jsonb_build_object('state', 'resumed', 'botId', bot.id, 'enabled', true, 'changed', false);
  end if;
  update bots set enabled = true where id = bot.id;
  perform policy_timeline(bot.id, bot.owner_id, 'bot.enabled', 'Resumed bot', p_now);
  return jsonb_build_object('state', 'resumed', 'botId', bot.id, 'enabled', true, 'changed', true);
end;
$$;

create or replace function policy_stop_all(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bot bots%rowtype;
  p_now timestamptz;
  bot_ids jsonb := '[]'::jsonb;
begin
  perform policy_assert_actor(payload->>'ownerId');
  p_now := policy_assert_time(payload);
  for bot in
    select * from bots where owner_id = payload->>'ownerId' order by id for update
  loop
    update bots set enabled = false where id = bot.id;
    perform policy_timeline(bot.id, bot.owner_id, 'kill.stop-all', 'Stop All', p_now);
    bot_ids := bot_ids || jsonb_build_array(bot.id);
  end loop;
  return jsonb_build_object('state', 'stopped', 'botIds', bot_ids);
end;
$$;

create or replace function policy_freeze_bot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bot bots%rowtype;
  p_now timestamptz;
  changed boolean;
begin
  perform policy_assert_actor(payload->>'ownerId');
  p_now := policy_assert_time(payload);
  select * into bot from bots where id = payload->>'botId' for update;
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'bot-missing');
  end if;
  if bot.owner_id is distinct from payload->>'ownerId' then
    return jsonb_build_object('state', 'blocked', 'reason', 'wrong-owner');
  end if;
  changed := (not bot.frozen) or bot.enabled;
  update bots set frozen = true, enabled = false where id = bot.id;
  if changed then
    perform policy_timeline(bot.id, bot.owner_id, 'bot.frozen', 'Froze bot', p_now);
  end if;
  return jsonb_build_object('state', 'frozen', 'botId', bot.id, 'frozen', true, 'enabled', false, 'changed', changed);
end;
$$;

create or replace function policy_unfreeze_bot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bot bots%rowtype;
  p_now timestamptz;
begin
  perform policy_assert_actor(payload->>'ownerId');
  p_now := policy_assert_time(payload);
  select * into bot from bots where id = payload->>'botId' for update;
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'bot-missing');
  end if;
  if bot.owner_id is distinct from payload->>'ownerId' then
    return jsonb_build_object('state', 'blocked', 'reason', 'wrong-owner');
  end if;
  if not bot.frozen then
    return jsonb_build_object('state', 'unfrozen', 'botId', bot.id, 'frozen', false, 'enabled', bot.enabled, 'changed', false);
  end if;
  update bots set frozen = false where id = bot.id;
  perform policy_timeline(bot.id, bot.owner_id, 'bot.unfrozen', 'Unfroze bot', p_now);
  return jsonb_build_object('state', 'unfrozen', 'botId', bot.id, 'frozen', false, 'enabled', bot.enabled, 'changed', true);
end;
$$;

create or replace function policy_freeze_wallet(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet wallets%rowtype;
  bot bots%rowtype;
  p_now timestamptz;
  changed boolean;
  bot_ids jsonb := '[]'::jsonb;
begin
  perform policy_assert_actor(payload->>'ownerId');
  p_now := policy_assert_time(payload);
  select * into wallet from wallets where id = payload->>'walletId' for update;
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'wallet-missing');
  end if;
  if wallet.owner_id is distinct from payload->>'ownerId' then
    return jsonb_build_object('state', 'blocked', 'reason', 'wrong-owner');
  end if;
  changed := not wallet.frozen;
  update wallets set frozen = true where id = wallet.id;
  for bot in
    select * from bots where wallet_id = wallet.id order by id for update
  loop
    bot_ids := bot_ids || jsonb_build_array(bot.id);
    if changed then
      perform policy_timeline(bot.id, bot.owner_id, 'wallet.frozen', 'Froze wallet', p_now);
    end if;
  end loop;
  return jsonb_build_object('state', 'frozen', 'walletId', wallet.id, 'botIds', bot_ids, 'changed', changed);
end;
$$;

create or replace function policy_unfreeze_wallet(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet wallets%rowtype;
  bot bots%rowtype;
  p_now timestamptz;
  changed boolean;
  bot_ids jsonb := '[]'::jsonb;
begin
  perform policy_assert_actor(payload->>'ownerId');
  p_now := policy_assert_time(payload);
  select * into wallet from wallets where id = payload->>'walletId' for update;
  if not found then
    return jsonb_build_object('state', 'blocked', 'reason', 'wallet-missing');
  end if;
  if wallet.owner_id is distinct from payload->>'ownerId' then
    return jsonb_build_object('state', 'blocked', 'reason', 'wrong-owner');
  end if;
  changed := wallet.frozen;
  update wallets set frozen = false where id = wallet.id;
  for bot in
    select * from bots where wallet_id = wallet.id order by id for update
  loop
    bot_ids := bot_ids || jsonb_build_array(bot.id);
    if changed then
      perform policy_timeline(bot.id, bot.owner_id, 'wallet.unfrozen', 'Unfroze wallet', p_now);
    end if;
  end loop;
  return jsonb_build_object('state', 'unfrozen', 'walletId', wallet.id, 'botIds', bot_ids, 'changed', changed);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'policy_amount(text)',
    'policy_int_text(numeric)',
    'policy_sha256_hex(text)',
    'policy_assert_actor(text)',
    'policy_assert_time(jsonb)',
    'policy_assert_proposal(jsonb)',
    'policy_proposal_digest(jsonb)',
    'policy_timeline(text, text, text, text, timestamp with time zone)',
    'policy_assess_spend(jsonb)',
    'policy_reserve_budget(jsonb)',
    'policy_pause_bot(jsonb)',
    'policy_resume_bot(jsonb)',
    'policy_stop_all(jsonb)',
    'policy_freeze_bot(jsonb)',
    'policy_unfreeze_bot(jsonb)',
    'policy_freeze_wallet(jsonb)',
    'policy_unfreeze_wallet(jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
  end loop;
  foreach fn in array array[
    'policy_assess_spend(jsonb)',
    'policy_reserve_budget(jsonb)',
    'policy_pause_bot(jsonb)',
    'policy_resume_bot(jsonb)',
    'policy_stop_all(jsonb)',
    'policy_freeze_bot(jsonb)',
    'policy_unfreeze_bot(jsonb)',
    'policy_freeze_wallet(jsonb)',
    'policy_unfreeze_wallet(jsonb)'
  ]
  loop
    execute format('grant execute on function %s to authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;

do $$
begin
  execute 'alter table budget_reservations replica identity full';
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table budget_reservations';
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;
-- Bot templates and creation (chunk 4C).
-- Three locked templates are seeded and cannot be deleted or hidden.
-- User templates can be created and deleted by their owner.
-- create_bot_draft inserts a disabled bot. enable_bot is a separate step.
-- No keys, signing, or secret values live here.

create table if not exists bot_templates (
  id text primary key check (id ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  owner_id text references users(id),
  name text not null check (char_length(name) between 1 and 64),
  goal text not null check (char_length(goal) between 1 and 4000),
  type text not null check (type in ('trading', 'shopping', 'position-management')),
  approval_mode text not null check (approval_mode in ('fully-automatic', 'capped-automatic', 'ask')),
  auto_approve_cap numeric,
  cap_mode text not null check (cap_mode in ('limited', 'unlimited')),
  cap_asset text not null check (char_length(cap_asset) between 1 and 64),
  max_outflow numeric,
  max_per_transaction numeric,
  max_loss numeric,
  builtin boolean not null default false,
  created_at timestamptz not null default now(),
  check (
    (
      builtin
      and owner_id is null
      and id = 'builtin:' || type
    )
    or (
      not builtin
      and owner_id is not null
      and id !~ '^builtin:'
    )
  )
);

alter table bot_templates drop constraint if exists bot_templates_cap_amounts_check;
alter table bot_templates add constraint bot_templates_cap_amounts_check check (
  cap_mode = 'unlimited'
  or (
    type = 'position-management'
    and max_loss is not null
    and max_loss >= 0
    and max_loss = trunc(max_loss)
  )
  or (
    type in ('trading', 'shopping')
    and max_outflow is not null
    and max_per_transaction is not null
    and max_outflow >= 0
    and max_per_transaction >= 0
    and max_outflow = trunc(max_outflow)
    and max_per_transaction = trunc(max_per_transaction)
  )
);

alter table bot_templates drop constraint if exists bot_templates_auto_approve_cap_check;
alter table bot_templates add constraint bot_templates_auto_approve_cap_check check (
  (
    approval_mode = 'capped-automatic'
    and auto_approve_cap is not null
    and auto_approve_cap >= 0
    and auto_approve_cap = trunc(auto_approve_cap)
  )
  or (
    approval_mode <> 'capped-automatic'
    and auto_approve_cap is null
  )
);

create index if not exists bot_templates_owner_idx on bot_templates(owner_id);

insert into bot_templates (
  id, owner_id, name, goal, type, approval_mode, auto_approve_cap,
  cap_mode, cap_asset, max_outflow, max_per_transaction, max_loss, builtin
) values
  (
    'builtin:trading', null, 'Trading',
    'Hunt stablecoin and blue-chip yield on hourly checks. No day trading and no meme coins.',
    'trading', 'ask', null,
    'limited', 'USDC', 50000000, 5000000, null, true
  ),
  (
    'builtin:shopping', null, 'Shopping',
    'Compare products on price and quality, then wait for approval before paying.',
    'shopping', 'ask', null,
    'limited', 'USDC', 50000000, 5000000, null, true
  ),
  (
    'builtin:position-management', null, 'Position management',
    'Watch paper positions and stop at the max-loss cap.',
    'position-management', 'ask', null,
    'limited', 'USDC', null, null, 10000000, true
  )
on conflict (id) do nothing;

create or replace function bot_templates_lock_builtins()
returns trigger
language plpgsql
as $$
begin
  if old.builtin then
    raise exception 'Locked templates cannot be deleted or hidden';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists bot_templates_lock_builtins on bot_templates;
create trigger bot_templates_lock_builtins
  before update or delete on bot_templates
  for each row execute function bot_templates_lock_builtins();

alter table bot_templates enable row level security;

drop policy if exists bot_templates_read on bot_templates;
create policy bot_templates_read on bot_templates
  for select to authenticated
  using (builtin or owner_id = app_owner_id());

revoke insert, update, delete on bot_templates from anon, authenticated;
grant select on bot_templates to authenticated;

create or replace function list_templates(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner text := payload->>'ownerId';
  rows jsonb;
begin
  perform policy_assert_actor(owner);
  select coalesce(jsonb_agg(item order by sort_builtin, sort_id), '[]'::jsonb)
    into rows
  from (
    select
      case
        when id = 'builtin:trading' then 0
        when id = 'builtin:shopping' then 1
        when id = 'builtin:position-management' then 2
        else 3
      end as sort_builtin,
      id as sort_id,
      jsonb_strip_nulls(jsonb_build_object(
        'id', id,
        'ownerId', owner_id,
        'name', name,
        'goal', goal,
        'type', type,
        'builtin', builtin,
        'deletable', not builtin,
        'defaultApprovalMode', approval_mode,
        'autoApproveCap', case when auto_approve_cap is null then null else trunc(auto_approve_cap)::text end,
        'defaultCap', jsonb_strip_nulls(jsonb_build_object(
          'mode', cap_mode,
          'asset', cap_asset,
          'maxOutflow', case when max_outflow is null then null else trunc(max_outflow)::text end,
          'maxPerTransaction', case when max_per_transaction is null then null else trunc(max_per_transaction)::text end,
          'maxLoss', case when max_loss is null then null else trunc(max_loss)::text end
        ))
      )) as item
    from bot_templates
    where builtin or owner_id = owner
  ) listed;
  return rows;
end;
$$;

create or replace function create_user_template(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner text := payload->>'ownerId';
  template_id text := payload->>'id';
  template_type text := payload->>'type';
  mode text := payload->>'approvalMode';
  cap jsonb := payload->'cap';
  cap_mode text := cap->>'mode';
  auto_cap numeric;
  outflow numeric;
  per_tx numeric;
  max_loss numeric;
begin
  perform policy_assert_actor(owner);
  if template_id is null or template_id !~ '^[a-zA-Z0-9:_-]{1,128}$' or template_id ~ '^builtin:' then
    raise exception 'Invalid template id';
  end if;
  if coalesce(char_length(payload->>'name'), 0) = 0 or char_length(payload->>'name') > 64
     or coalesce(char_length(payload->>'goal'), 0) = 0 or char_length(payload->>'goal') > 4000
  then
    raise exception 'Template name and goal are required';
  end if;
  if template_type is null or template_type not in ('trading', 'shopping', 'position-management') then
    raise exception 'A supported bot type is required';
  end if;
  if mode is null or mode not in ('fully-automatic', 'capped-automatic', 'ask') then
    raise exception 'Approval mode must be fully-automatic, capped-automatic, or ask';
  end if;
  if mode = 'capped-automatic' then
    auto_cap := policy_amount(payload->>'autoApproveCap');
  elsif nullif(payload->>'autoApproveCap', '') is not null then
    raise exception 'autoApproveCap is only for capped-automatic';
  end if;
  if cap is null or cap_mode not in ('limited', 'unlimited')
     or coalesce(char_length(cap->>'asset'), 0) = 0 or char_length(cap->>'asset') > 64
  then
    raise exception 'Explicit cap choice and accounting asset are required';
  end if;
  if cap_mode = 'limited' and template_type = 'position-management' then
    max_loss := policy_amount(cap->>'maxLoss');
  elsif cap_mode = 'limited' then
    outflow := policy_amount(cap->>'maxOutflow');
    per_tx := policy_amount(cap->>'maxPerTransaction');
  end if;
  insert into bot_templates (
    id, owner_id, name, goal, type, approval_mode, auto_approve_cap,
    cap_mode, cap_asset, max_outflow, max_per_transaction, max_loss, builtin
  ) values (
    template_id, owner, payload->>'name', payload->>'goal', template_type, mode, auto_cap,
    cap_mode, cap->>'asset', outflow, per_tx, max_loss, false
  );
  return jsonb_build_object('id', template_id, 'builtin', false, 'deletable', true);
exception when unique_violation then
  raise exception 'Template id already exists';
end;
$$;

create or replace function delete_user_template(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner text := payload->>'ownerId';
  template_id text := payload->>'templateId';
  template bot_templates%rowtype;
begin
  perform policy_assert_actor(owner);
  select * into template from bot_templates where id = template_id for update;
  if not found then
    raise exception 'Template not found';
  end if;
  if template.builtin or template.id ~ '^builtin:' then
    raise exception 'Locked templates cannot be deleted';
  end if;
  if template.owner_id is distinct from owner then
    raise exception 'Template owner must match';
  end if;
  delete from bot_templates where id = template.id;
  return jsonb_build_object('deleted', true, 'id', template.id);
end;
$$;

create or replace function create_bot_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner text := payload->>'ownerId';
  bot_id text := payload->>'id';
  bot_type text := payload->>'type';
  mode text := payload->>'approvalMode';
  cap jsonb := payload->'cap';
  cap_mode text := cap->>'mode';
  template_id text := nullif(payload->>'templateId', '');
  wallet wallets%rowtype;
  template bot_templates%rowtype;
  missing text := '';
  auto_cap numeric;
  outflow numeric;
  per_tx numeric;
  max_loss numeric;
begin
  perform policy_assert_actor(owner);
  if bot_id is null or bot_id !~ '^[a-zA-Z0-9:_-]{1,128}$'
     or coalesce(char_length(payload->>'name'), 0) = 0 or char_length(payload->>'name') > 64
     or coalesce(char_length(payload->>'goal'), 0) = 0 or char_length(payload->>'goal') > 4000
  then
    raise exception 'Bot identity, name, owner, and goal are required';
  end if;
  if bot_type is null or bot_type not in ('trading', 'shopping', 'position-management') then
    missing := missing || 'type, ';
  end if;
  select * into wallet from wallets where id = payload->>'walletId' for update;
  if not found then
    missing := missing || 'wallet, ';
  end if;
  if cap is null or cap_mode not in ('limited', 'unlimited')
     or coalesce(char_length(cap->>'asset'), 0) = 0 or char_length(cap->>'asset') > 64
  then
    missing := missing || 'caps, ';
  end if;
  if mode is null or mode not in ('fully-automatic', 'capped-automatic', 'ask') then
    missing := missing || 'approval-mode, ';
  elsif mode = 'capped-automatic' and nullif(payload->>'autoApproveCap', '') is null then
    missing := missing || 'auto-approve-cap, ';
  end if;
  if missing <> '' then
    raise exception 'Creation needs %', left(missing, char_length(missing) - 2);
  end if;
  if wallet.owner_id is distinct from owner then
    raise exception 'Wallet owner must match bot owner';
  end if;
  if wallet.frozen or wallet.provider <> 'privy' then
    raise exception 'Cannot assign a frozen wallet';
  end if;
  if mode = 'capped-automatic' then
    auto_cap := policy_amount(payload->>'autoApproveCap');
  elsif nullif(payload->>'autoApproveCap', '') is not null then
    raise exception 'autoApproveCap is only for capped-automatic';
  end if;
  if cap_mode = 'limited' and bot_type = 'position-management' then
    max_loss := policy_amount(cap->>'maxLoss');
  elsif cap_mode = 'limited' then
    outflow := policy_amount(cap->>'maxOutflow');
    per_tx := policy_amount(cap->>'maxPerTransaction');
  end if;
  if template_id is not null then
    if template_id !~ '^[a-zA-Z0-9:_-]{1,128}$' then
      raise exception 'Invalid template id';
    end if;
    select * into template from bot_templates where id = template_id;
    if not found or (not template.builtin and template.owner_id is distinct from owner) then
      raise exception 'Invalid template id';
    end if;
  end if;
  insert into bots (
    id, owner_id, wallet_id, name, goal, type, approval_mode, auto_approve_cap, template_id,
    enabled, frozen, policy_version, cap_mode, cap_asset, max_outflow, max_per_transaction, max_loss
  ) values (
    bot_id, owner, wallet.id, payload->>'name', payload->>'goal', bot_type, mode, auto_cap, template_id,
    false, false, 1, cap_mode, cap->>'asset', outflow, per_tx, max_loss
  );
  insert into spend_ledgers (bot_id, asset, spent, reserved, realized_loss)
  values (bot_id, cap->>'asset', 0, 0, 0);
  perform policy_timeline(bot_id, owner, 'bot.created', 'Created bot draft', policy_assert_time(payload));
  return jsonb_build_object(
    'state', 'draft',
    'enabled', false,
    'id', bot_id,
    'walletId', wallet.id,
    'type', bot_type,
    'approvalMode', mode,
    'capMode', cap_mode
  );
exception when unique_violation then
  raise exception 'Bot id already exists';
end;
$$;

create or replace function enable_bot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner text := payload->>'ownerId';
  bot bots%rowtype;
  changed boolean;
begin
  perform policy_assert_actor(owner);
  select * into bot from bots where id = payload->>'botId' for update;
  if not found then
    raise exception 'Bot not found';
  end if;
  if bot.owner_id is distinct from owner then
    raise exception 'Bot owner must match';
  end if;
  if bot.frozen then
    raise exception 'Bot is frozen';
  end if;
  changed := not bot.enabled;
  update bots set enabled = true where id = bot.id;
  if changed then
    perform policy_timeline(bot.id, bot.owner_id, 'bot.enabled', 'Enabled bot', policy_assert_time(payload));
  end if;
  return jsonb_build_object('state', 'enabled', 'id', bot.id, 'enabled', true, 'changed', changed);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'list_templates(jsonb)',
    'create_user_template(jsonb)',
    'delete_user_template(jsonb)',
    'create_bot_draft(jsonb)',
    'enable_bot(jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;

do $$
begin
  execute 'alter table bot_templates replica identity full';
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table bot_templates';
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;
