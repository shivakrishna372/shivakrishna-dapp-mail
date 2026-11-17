-- DAPP Mail — Step 3: empty Trash automatically after 30 days (daily at 02:50 IST)
create extension if not exists pg_cron;
select cron.schedule(
  'dapp-empty-trash',
  '20 21 * * *',
  $$delete from public.mailbox where folder = 'trash' and trashed_at < now() - interval '30 days'$$
);
