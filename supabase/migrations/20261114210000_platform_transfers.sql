-- Platform ledger for @handle sends.
-- An agent posts USDC from the sender's main wallet to the recipient's main wallet.
-- This is not a chain broadcast. Both owners read the same row in their wallet.

create table if not exists platform_transfers (
  id text primary key,
  idempotency_key text not null unique,
  from_owner_id text not null references users(id),
  to_owner_id text not null references users(id),
  from_wallet_id text not null references wallets(id),
  to_wallet_id text not null references wallets(id),
  bot_id text,
  handle text not null,
  amount numeric not null,
  asset text not null default 'USDC',
  created_at timestamptz not null default now(),
  check (id ~ '^[a-zA-Z0-9:_-]{8,128}$'),
  check (idempotency_key ~ '^[a-zA-Z0-9:_-]{8,128}$'),
  check (from_owner_id <> to_owner_id),
  check (bot_id is null or bot_id ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  check (handle ~ '^[a-z0-9][a-z0-9_]{1,31}$'),
  check (amount > 0 and amount = trunc(amount)),
  check (asset = 'USDC')
);

create index if not exists platform_transfers_from_idx on platform_transfers (from_owner_id, created_at desc);
create index if not exists platform_transfers_to_idx on platform_transfers (to_owner_id, created_at desc);

alter table platform_transfers enable row level security;

drop policy if exists platform_transfers_party_read on platform_transfers;
create policy platform_transfers_party_read on platform_transfers
  for select to authenticated
  using (from_owner_id = app_owner_id() or to_owner_id = app_owner_id());

revoke all on platform_transfers from public, anon, authenticated;
grant select on platform_transfers to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all privileges on table platform_transfers to service_role;
  end if;
end $$;

create or replace function platform_post_transfer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner text := payload->>'ownerId';
  v_handle text := payload->>'handle';
  v_key text := payload->>'idempotencyKey';
  v_bot text := nullif(payload->>'botId', '');
  v_amount numeric;
  v_to text;
  v_from_wallet wallets%rowtype;
  v_to_wallet wallets%rowtype;
  existing platform_transfers%rowtype;
  inserted platform_transfers%rowtype;
begin
  if v_owner is null or v_owner !~ '^[a-zA-Z0-9:_-]{1,128}$' then
    raise exception 'owner_required';
  end if;
  if v_handle is null or v_handle !~ '^[a-z0-9][a-z0-9_]{1,31}$' then
    raise exception 'invalid_handle';
  end if;
  if v_key is null or v_key !~ '^[a-zA-Z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key_required';
  end if;
  if payload->>'amount' is null or payload->>'amount' !~ '^[1-9][0-9]{0,39}$' then
    raise exception 'invalid_amount';
  end if;
  v_amount := (payload->>'amount')::numeric;
  if v_bot is not null and v_bot !~ '^[a-zA-Z0-9:_-]{1,128}$' then
    raise exception 'invalid_bot';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select * into existing from platform_transfers where idempotency_key = v_key;
  if found then
    if existing.from_owner_id is distinct from v_owner
       or existing.handle is distinct from v_handle
       or existing.amount is distinct from v_amount
       or existing.bot_id is distinct from v_bot then
      raise exception 'idempotency_mismatch';
    end if;
    return jsonb_build_object('replay', true, 'transfer', to_jsonb(existing));
  end if;

  select owner_id into v_to from profiles where lower(handle) = v_handle;
  if not found then
    raise exception 'handle_missing';
  end if;
  if v_to = v_owner then
    raise exception 'self_transfer';
  end if;

  select * into v_from_wallet from wallets
    where owner_id = v_owner and kind = 'main'
    order by created_at asc
    limit 1
    for update;
  if not found then
    raise exception 'sender_wallet_missing';
  end if;
  if v_from_wallet.frozen then
    raise exception 'wallet_frozen';
  end if;

  select * into v_to_wallet from wallets
    where owner_id = v_to and kind = 'main'
    order by created_at asc
    limit 1
    for update;
  if not found then
    raise exception 'recipient_wallet_missing';
  end if;

  insert into platform_transfers (
    id, idempotency_key, from_owner_id, to_owner_id,
    from_wallet_id, to_wallet_id, bot_id, handle, amount, asset
  ) values (
    v_key, v_key, v_owner, v_to,
    v_from_wallet.id, v_to_wallet.id, v_bot, v_handle, v_amount, 'USDC'
  )
  returning * into inserted;

  return jsonb_build_object('replay', false, 'transfer', to_jsonb(inserted));
end;
$$;

revoke all on function platform_post_transfer(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function platform_post_transfer(jsonb) to service_role;
  end if;
end $$;
