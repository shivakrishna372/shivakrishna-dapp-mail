-- =====================================================================
--  DAPP Mail — Step 5: Schedule send + Snooze
-- =====================================================================

alter table public.messages add column if not exists scheduled_at timestamptz;

alter table public.mailbox drop constraint if exists mailbox_folder_check;
alter table public.mailbox add constraint mailbox_folder_check
  check (folder in ('inbox', 'sent', 'drafts', 'scheduled', 'archive', 'trash'));

create index if not exists messages_scheduled_idx on public.messages (scheduled_at)
  where sent_at is null and scheduled_at is not null;
create index if not exists mailbox_snoozed_idx on public.mailbox (snoozed_until)
  where snoozed_until is not null;

-- Internal: actually deliver a message. Not callable from the app.
create or replace function public.deliver_message(p_message_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_msg     public.messages%rowtype;
  v_thread  uuid;
begin
  select * into v_msg from public.messages where id = p_message_id for update;
  if not found or v_msg.sent_at is not null then
    return null;
  end if;

  v_thread := v_msg.thread_id;
  if v_thread is null then
    insert into public.threads (subject)
    values (coalesce(nullif(trim(v_msg.subject), ''), '(no subject)'))
    returning id into v_thread;
  end if;

  update public.messages
     set sent_at = now(), scheduled_at = null, thread_id = v_thread
   where id = p_message_id;
  update public.threads set last_message_at = now() where id = v_thread;

  update public.mailbox set folder = 'sent', is_read = true
   where message_id = p_message_id and user_id = v_msg.sender_id;

  insert into public.mailbox (message_id, user_id, folder, is_read)
  select p_message_id, r.user_id, 'inbox', false
    from public.message_recipients r
   where r.message_id = p_message_id and r.user_id <> v_msg.sender_id
  on conflict (message_id, user_id) do nothing;

  return v_thread;
end;
$$;

-- Send now, or schedule for later when p_send_at is in the future.
drop function if exists public.send_message(uuid);

create or replace function public.send_message(p_message_id uuid, p_send_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages%rowtype;
begin
  if v_uid is null then
    raise exception 'You are not logged in';
  end if;
  if not public.is_active_user() then
    raise exception 'Finish your account setup first';
  end if;

  select * into v_msg from public.messages where id = p_message_id for update;
  if not found or v_msg.sender_id <> v_uid then
    raise exception 'Message not found';
  end if;
  if v_msg.sent_at is not null then
    raise exception 'This message was already sent';
  end if;
  if not exists (select 1 from public.message_recipients where message_id = p_message_id) then
    raise exception 'Please add at least one recipient';
  end if;
  if v_msg.thread_id is not null and not public.can_see_thread(v_msg.thread_id) then
    raise exception 'Invalid conversation';
  end if;

  if p_send_at is not null and p_send_at > now() + interval '30 seconds' then
    if p_send_at > now() + interval '1 year' then
      raise exception 'You can schedule up to one year ahead';
    end if;
    update public.messages set scheduled_at = p_send_at where id = p_message_id;
    update public.mailbox set folder = 'scheduled'
     where message_id = p_message_id and user_id = v_uid;
    return v_msg.thread_id;
  end if;

  return public.deliver_message(p_message_id);
end;
$$;

-- Cancel a scheduled send: it goes back to Drafts.
create or replace function public.cancel_scheduled(p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.messages set scheduled_at = null
   where id = p_message_id and sender_id = auth.uid()
     and sent_at is null and scheduled_at is not null;
  if not found then
    raise exception 'Scheduled message not found';
  end if;
  update public.mailbox set folder = 'drafts'
   where message_id = p_message_id and user_id = auth.uid();
end;
$$;

-- Runs every minute: deliver due scheduled mail, bring back snoozed mail.
create or replace function public.run_mail_jobs()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select m.id from public.messages m
     where m.sent_at is null and m.scheduled_at is not null and m.scheduled_at <= now()
     order by m.scheduled_at
     limit 200
  loop
    if exists (select 1 from public.message_recipients where message_id = r.id) then
      perform public.deliver_message(r.id);
    else
      update public.messages set scheduled_at = null where id = r.id;
      update public.mailbox set folder = 'drafts'
       where message_id = r.id and folder = 'scheduled';
    end if;
  end loop;

  update public.mailbox
     set snoozed_until = null, is_read = false
   where snoozed_until is not null and snoozed_until <= now();
end;
$$;

revoke execute on function public.deliver_message(uuid), public.run_mail_jobs()
  from public, anon, authenticated;
revoke execute on function public.send_message(uuid, timestamptz), public.cancel_scheduled(uuid)
  from public, anon;
grant execute on function public.send_message(uuid, timestamptz), public.cancel_scheduled(uuid)
  to authenticated;
select cron.schedule('dapp-mail-jobs', '* * * * *', $$select public.run_mail_jobs()$$);
