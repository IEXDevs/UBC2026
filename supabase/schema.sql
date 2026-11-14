-- Maelstrom / UBC2026 Supabase schema (Postgres)
-- Keys stay in Privy; this DB holds assignments, ledgers, and audit records.

create extension if not exists "pgcrypto";

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

create index if not exists bots_owner_idx on bots(owner_id);
create index if not exists bots_wallet_idx on bots(wallet_id);
create index if not exists timeline_bot_at_idx on timeline_events(bot_id, at desc);
create index if not exists payments_bot_idx on payments(bot_id, created_at desc);
