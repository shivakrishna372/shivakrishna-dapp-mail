-- DAPP Mail — Step 4: rate-limit password reset emails
alter table public.user_security add column if not exists last_reset_requested_at timestamptz;
