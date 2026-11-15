-- Linked sign-in methods and read-only wallets belong to the same owner.
-- A later login with any linked method resolves to this users.id.
-- spendable is false for wallets the owner connected. Those rows never sign.

alter table users
  add column if not exists login_methods jsonb not null default '[]'::jsonb;

alter table wallets
  add column if not exists spendable boolean not null default true;
