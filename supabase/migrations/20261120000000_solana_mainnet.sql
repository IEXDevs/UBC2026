-- Historical rows retain their network. Never relabel test funds as mainnet funds.
create or replace function policy_execution_cluster()
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  configured text := coalesce(nullif(current_setting('app.solana_cluster', true), ''), 'mainnet-beta');
begin
  if configured not in ('mainnet-beta', 'devnet') then
    raise exception 'Unsupported app.solana_cluster';
  end if;
  return configured;
end;
$$;

do $$
declare
  relation text;
begin
  foreach relation in array array['decision_records', 'payments', 'stream_events', 'paper_positions', 'paper_fills'] loop
    if to_regclass('public.' || relation) is not null then
      execute format('alter table %I drop constraint if exists %I', relation, relation || '_cluster_check');
      execute format('alter table %I add constraint %I check (cluster in (''mainnet-beta'', ''devnet'', ''testnet''))', relation, relation || '_cluster_check');
      execute format('alter table %I alter column cluster set default policy_execution_cluster()', relation);
    end if;
  end loop;
  if to_regclass('public.paper_positions') is not null then
    alter table paper_positions alter column label set default (policy_execution_cluster() || ' execution, mainnet pricing');
  end if;
end;
$$;

create or replace function policy_assert_proposal(proposal jsonb)
returns void
language plpgsql
stable
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
  if proposal->>'cluster' is null or proposal->>'cluster' <> policy_execution_cluster() then
    raise exception 'Execution must use the configured Solana cluster';
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
