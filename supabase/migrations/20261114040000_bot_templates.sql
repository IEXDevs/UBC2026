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
