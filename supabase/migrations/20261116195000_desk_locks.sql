-- Desk password verifier and the hash of the current spend grant.
-- The password and the grant are not columns.

create table if not exists desk_locks (
  owner_id text primary key references users(id),
  salt text not null,
  hash text not null,
  iterations integer not null,
  grant_hash text,
  grant_until timestamptz,
  check (salt ~ '^[0-9a-f]{32}$'),
  check (hash ~ '^[0-9a-f]{64}$'),
  check (iterations between 10000 and 2000000),
  check (grant_hash is null or grant_hash ~ '^[0-9a-f]{64}$')
);

alter table desk_locks enable row level security;

revoke all on desk_locks from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all privileges on table desk_locks to service_role;
  end if;
end $$;
