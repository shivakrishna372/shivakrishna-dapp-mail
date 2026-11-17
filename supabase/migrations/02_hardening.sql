-- =====================================================================
--  DAPP Mail — Step 2: security hardening + search
--  (applied by Claude via the Supabase connector)
-- =====================================================================

-- 1. Every new user automatically gets a security record (first-login setup).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, username, display_name)
  values (
    new.id,
    lower(new.email),
    lower(split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
             split_part(new.email, '@', 1))
  );
  insert into public.user_security (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Backfill anyone who is missing a security record.
insert into public.user_security (user_id)
select p.id from public.profiles p
where not exists (select 1 from public.user_security s where s.user_id = p.id);

-- 2. Lock the search path on the admin-protection trigger function.
alter function public.prevent_self_admin_change() set search_path = '';

-- 3. "Active user" = finished first-login setup (recovery email + own password).
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select first_login_completed from public.user_security where user_id = auth.uid()),
    false
  );
$$;

-- Restrictive policies are ANDed with the existing ones:
-- nobody can touch mail data until their setup is complete.
do $$
declare t text;
begin
  foreach t in array array['profiles','threads','messages','message_recipients',
                           'mailbox','labels','mailbox_labels','attachments']
  loop
    execute format(
      'create policy "active users only" on public.%I as restrictive
         for all to authenticated
         using (public.is_active_user()) with check (public.is_active_user())', t);
  end loop;
end $$;

create policy "attachments files: active users only" on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'attachments' or public.is_active_user())
  with check (bucket_id <> 'attachments' or public.is_active_user());

-- 4. Sending also requires an active account.
create or replace function public.send_message(p_message_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_msg     public.messages%rowtype;
  v_thread  uuid;
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

  v_thread := v_msg.thread_id;
  if v_thread is not null then
    if not public.can_see_thread(v_thread) then
      raise exception 'Invalid conversation';
    end if;
  else
    insert into public.threads (subject)
    values (coalesce(nullif(trim(v_msg.subject), ''), '(no subject)'))
    returning id into v_thread;
  end if;

  update public.messages set sent_at = now(), thread_id = v_thread where id = p_message_id;
  update public.threads  set last_message_at = now() where id = v_thread;

  update public.mailbox set folder = 'sent', is_read = true
  where message_id = p_message_id and user_id = v_uid;

  insert into public.mailbox (message_id, user_id, folder, is_read)
  select p_message_id, r.user_id, 'inbox', false
  from public.message_recipients r
  where r.message_id = p_message_id and r.user_id <> v_uid
  on conflict (message_id, user_id) do nothing;

  return v_thread;
end;
$$;

-- 5. Server-side search across your own mail (respects all security rules).
create or replace function public.search_mailbox(p_query text)
returns setof public.mailbox
language sql stable security invoker set search_path = '' as $$
  with q as (
    select '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select mb.*
  from public.mailbox mb
  join public.messages m on m.id = mb.message_id
  join public.profiles s on s.id = m.sender_id
  cross join q
  where mb.user_id = auth.uid()
    and mb.folder <> 'trash'
    and length(trim(p_query)) > 0
    and (m.subject ilike q.pat or m.body_text ilike q.pat
         or s.email ilike q.pat or s.display_name ilike q.pat)
  order by mb.created_at desc
  limit 200;
$$;

revoke execute on function public.is_active_user(), public.search_mailbox(text) from public, anon;
grant execute on function public.is_active_user(), public.search_mailbox(text) to authenticated;
