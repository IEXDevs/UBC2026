-- Account-scoped desk state and the one seed phrase per account.
--
-- owner_state mirrors what the desk used to keep only in the browser: roster,
-- looks, talks, token prefs, spend permission, the Review by AI cap, voice
-- time, voice settings, and the account id. File secrets, provider keys, the
-- desk password, and the seed phrase are never rows here.
--
-- owner_recovery holds at most one row per account. While status is issued,
-- vault is the seed phrase encrypted in the browser with the onboarding
-- password, so the same phrase comes back on another browser. The server
-- cannot read it. Confirming the phrase deletes the vault and keeps only a
-- PBKDF2 verifier so a later browser can prove the owner still has the phrase.

create table if not exists owner_state (
  owner_id text not null references users(id),
  name text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, name),
  check (owner_id ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  check (name in (
    'roster', 'looks', 'talks', 'tokens', 'permission', 'reviewCap',
    'acceptance', 'voiceTime', 'voiceSettings', 'accountCode'
  )),
  check (char_length(value) <= 1000000),
  check (name <> 'accountCode' or value ~ '^[0-9]{16}$')
);

alter table owner_state enable row level security;
alter table owner_state force row level security;

revoke all on owner_state from public, anon, authenticated;

create table if not exists owner_recovery (
  owner_id text primary key references users(id),
  status text not null,
  vault jsonb,
  verifier_salt text not null,
  verifier_hash text not null,
  verifier_iterations integer not null,
  issued_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check (owner_id ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  check (status in ('issued', 'confirmed')),
  check (
    (status = 'issued' and vault is not null and confirmed_at is null)
    or (status = 'confirmed' and vault is null and confirmed_at is not null)
  ),
  check (verifier_salt ~ '^[0-9a-f]{32}$'),
  check (verifier_hash ~ '^[0-9a-f]{64}$'),
  check (verifier_iterations between 10000 and 2000000)
);

alter table owner_recovery enable row level security;
alter table owner_recovery force row level security;

revoke all on owner_recovery from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all privileges on table owner_state to service_role;
    grant all privileges on table owner_recovery to service_role;
  end if;
end $$;
