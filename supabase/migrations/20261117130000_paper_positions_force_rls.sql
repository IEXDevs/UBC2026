-- Harden paper_* privileges for environments that already applied 20261117120000:
-- FORCE RLS (table owners cannot skip) and revoke authenticated DML.
-- Worker continues to write through service_role (bypassrls).

alter table if exists paper_positions force row level security;
alter table if exists paper_fills force row level security;
alter table if exists position_checks force row level security;

revoke insert, update, delete on table paper_positions from authenticated;
revoke insert, update, delete on table paper_fills from authenticated;
revoke insert, update, delete on table position_checks from authenticated;

grant select on table paper_positions to authenticated;
grant select on table paper_fills to authenticated;
grant select on table position_checks to authenticated;
