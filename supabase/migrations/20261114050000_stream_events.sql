-- Isaac / 5A: durable QuickNode Streams event log + dedupe by tx signature

create table if not exists stream_events (
  signature text primary key,
  wallet text not null,
  bot_id text references bots(id),
  owner_id text references users(id),
  event_type text not null,
  amount numeric,
  token text,
  slot bigint,
  cluster text not null default 'devnet' check (cluster in ('devnet', 'testnet')),
  raw jsonb,
  processed_at timestamptz not null default now()
);

create index if not exists stream_events_wallet_idx on stream_events(wallet, processed_at desc);
create index if not exists stream_events_bot_idx on stream_events(bot_id, processed_at desc);

alter table stream_events enable row level security;

-- Service role writes from the Worker; owners can read their rows.
drop policy if exists stream_events_owner_read on stream_events;
create policy stream_events_owner_read on stream_events
  for select
  using (owner_id = app_owner_id());

revoke insert, update, delete on stream_events from anon, authenticated;
