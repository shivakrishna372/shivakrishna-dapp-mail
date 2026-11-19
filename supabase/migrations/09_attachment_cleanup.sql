-- =====================================================================
--  DAPP Mail — Step 9: save attachment space
--  * Forwarding re-uses the original file instead of copying it.
--  * Daily cleanup removes mails nobody has any more, and their files.
-- =====================================================================

-- True if the signed-in user can see any message that references this file.
create or replace function public.can_view_file(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.attachments a
    where a.file_path = p_path and public.can_view_message(a.message_id)
  );
$$;
revoke execute on function public.can_view_file(text) from public, anon;
grant execute on function public.can_view_file(text) to authenticated;

-- Files: visible to anyone who can see a message that uses the file (covers forwarded files).
drop policy if exists "attachments files: view" on storage.objects;
create policy "attachments files: view" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (public.can_view_message(public.path_message_id(name)) or public.can_view_file(name))
  );

-- Attaching to your draft: either a file you uploaded into this draft,
-- or (when forwarding) a file you are already allowed to see.
drop policy if exists "attachments: add to own draft" on public.attachments;
create policy "attachments: add to own draft" on public.attachments
  for insert to authenticated
  with check (
    public.is_own_draft(message_id)
    and (public.path_message_id(file_path) = message_id or public.can_view_file(file_path))
  );

-- Server-only: delete mails that no one has in any folder (deleted forever by everyone),
-- then return storage files that no mail uses any more (the cleanup function deletes them).
create or replace function public.collect_garbage()
returns setof text language plpgsql security definer set search_path = '' as $$
begin
  delete from public.messages m
   where m.sent_at is not null
     and not exists (select 1 from public.mailbox mb where mb.message_id = m.id);

  delete from public.threads t
   where not exists (select 1 from public.messages m where m.thread_id = t.id);

  return query
    select o.name from storage.objects o
     where o.bucket_id = 'attachments'
       and o.created_at < now() - interval '1 hour'   -- never touch uploads in progress
       and not exists (select 1 from public.attachments a where a.file_path = o.name)
     limit 1000;
end;
$$;
revoke execute on function public.collect_garbage() from public, anon, authenticated;
grant execute on function public.collect_garbage() to service_role;

-- Run the cleanup every night at 03:30 IST.
select cron.schedule(
  'dapp-storage-cleanup',
  '0 22 * * *',
  $$select net.http_post(
      url     := 'https://ybckrpmjfkoyaaczwnul.supabase.co/functions/v1/storage-cleanup',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dapp_push_hook_secret')
      ),
      timeout_milliseconds := 30000
    )$$
);
