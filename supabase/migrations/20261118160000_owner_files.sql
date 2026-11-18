-- Owner file records. The 128-character id is not stored. The row keeps its hash,
-- the 16-digit account id, and the name. A missing Drive file deletes the row.

create table if not exists owner_files (
  secret_hash text primary key,
  owner_id text not null references users(id),
  account_code text not null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  added_at timestamptz not null default now(),
  check (secret_hash ~ '^[a-f0-9]{64}$'),
  check (owner_id ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  check (account_code ~ '^[0-9]{16}$'),
  check (char_length(name) between 1 and 180),
  check (char_length(mime_type) between 1 and 120),
  check (size_bytes >= 0 and size_bytes <= 512000000)
);

create index if not exists owner_files_owner_idx on owner_files (owner_id, added_at desc);

alter table owner_files enable row level security;
alter table owner_files force row level security;

drop policy if exists owner_files_owner_select on owner_files;
create policy owner_files_owner_select on owner_files
  for select to authenticated
  using (owner_id = app_owner_id());

revoke all on owner_files from public, anon;
grant select on owner_files to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all privileges on table owner_files to service_role;
  end if;
end $$;
