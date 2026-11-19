-- Soft-delete additional wallets. The row stays so history can still point at it.
alter table wallets add column if not exists deleted_at timestamptz;
