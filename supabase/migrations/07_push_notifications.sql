-- =====================================================================
--  DAPP Mail — Step 7: push notifications (like WhatsApp)
--  Keys live in Supabase Vault: dapp_vapid_private, dapp_vapid_public,
--  dapp_push_hook_secret (created separately, never stored in code).
-- =====================================================================

-- One row per device (phone / browser) that turned notifications on.
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  endpoint      text not null unique check (endpoint ~ '^https://'),
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push: view own" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "push: add own" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
create policy "push: remove own" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
create policy "active users only" on public.push_subscriptions as restrictive
  for all to authenticated using (public.is_active_user()) with check (public.is_active_user());

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- Server-only: gives the send-push function its keys from Vault.
create or replace function public.get_push_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'vapid_public',  (select decrypted_secret from vault.decrypted_secrets where name = 'dapp_vapid_public'),
    'vapid_private', (select decrypted_secret from vault.decrypted_secrets where name = 'dapp_vapid_private'),
    'hook_secret',   (select decrypted_secret from vault.decrypted_secrets where name = 'dapp_push_hook_secret')
  );
$$;
revoke execute on function public.get_push_config() from public, anon, authenticated;
grant execute on function public.get_push_config() to service_role;

-- When mail lands in someone's Inbox (or comes back from Snooze), ask send-push to notify them.
create extension if not exists pg_net;

create or replace function public.notify_new_mail()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.folder = 'inbox' and not new.is_read and new.snoozed_until is null
     and (tg_op = 'INSERT' or old.snoozed_until is not null) then
    begin
      perform net.http_post(
        url     := 'https://ybckrpmjfkoyaaczwnul.supabase.co/functions/v1/send-push',
        body    := jsonb_build_object('mailbox_id', new.id),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dapp_push_hook_secret')
        ),
        timeout_milliseconds := 5000
      );
    exception when others then
      -- Never block mail delivery because of a notification problem.
      raise warning 'notify_new_mail: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_new_mail() from public, anon, authenticated;

drop trigger if exists on_mailbox_notify on public.mailbox;
create trigger on_mailbox_notify
  after insert or update of snoozed_until on public.mailbox
  for each row execute function public.notify_new_mail();
