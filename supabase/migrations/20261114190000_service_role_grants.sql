-- The CLI login role owns these tables. Hosted default privileges did not
-- grant them to service_role, so the Worker received permission denied.
-- service_role bypasses row level security. Owner isolation stays in the
-- authenticated policies and in the Worker queries.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
