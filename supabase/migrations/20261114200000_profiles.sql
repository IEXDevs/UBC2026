-- Public handles. @alex pays the owner of that handle.
-- @name.sol stays on the SNS path and is not stored here.
-- Authenticated users can read the directory. Only the owner can write their row.

create table if not exists profiles (
  owner_id text primary key references users(id),
  handle text not null,
  display_name text not null,
  avatar_url text,
  updated_at timestamptz not null default now(),
  check (owner_id ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  check (handle ~ '^[a-z0-9][a-z0-9_]{1,31}$'),
  check (char_length(display_name) between 1 and 64),
  check (avatar_url is null or avatar_url ~ '^https://[^[:space:]]+$')
);

create unique index if not exists profiles_handle_uidx on profiles (lower(handle));

alter table profiles enable row level security;
alter table profiles force row level security;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_owner_insert on profiles;
create policy profiles_owner_insert on profiles
  for insert to authenticated
  with check (owner_id = app_owner_id());

drop policy if exists profiles_owner_update on profiles;
create policy profiles_owner_update on profiles
  for update to authenticated
  using (owner_id = app_owner_id())
  with check (owner_id = app_owner_id());

revoke all on profiles from public, anon;
grant select, insert, update on profiles to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all privileges on table profiles to service_role;
  end if;
end $$;
