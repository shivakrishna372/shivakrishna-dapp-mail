-- =====================================================================
--  DAPP Mail — Step 1: Database setup
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run once on a fresh project.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- One row per user. Created automatically when you add a user in
-- Authentication → Users (see the trigger further down).
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique,          -- e.g. rahul@dapp.com
  username      text not null unique,          -- e.g. rahul
  display_name  text not null,                 -- e.g. Rahul Kumar
  avatar_url    text,
  signature     text not null default '',
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- A conversation (Gmail groups replies into one thread).
create table public.threads (
  id               uuid primary key default gen_random_uuid(),
  subject          text not null default '(no subject)',
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now()
);

-- Every email. While sent_at is NULL the message is a draft that only
-- the sender can see or edit.
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid references public.threads (id) on delete cascade,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  in_reply_to  uuid references public.messages (id) on delete set null,
  subject      text not null default '',
  body_html    text not null default '' check (char_length(body_html) <= 500000),
  body_text    text not null default '' check (char_length(body_text) <= 200000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sent_at      timestamptz                         -- NULL = draft
);

-- Who a message is addressed to: To / Cc / Bcc.
create table public.message_recipients (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('to', 'cc', 'bcc')),
  primary key (message_id, user_id)
);

-- Each person's own copy of a message: folder, read, star, etc.
-- Deleting your copy never affects anyone else's.
create table public.mailbox (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.messages (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  folder         text not null default 'inbox'
                 check (folder in ('inbox', 'sent', 'drafts', 'archive', 'trash')),
  is_read        boolean not null default false,
  is_starred     boolean not null default false,
  is_important   boolean not null default false,
  snoozed_until  timestamptz,
  trashed_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (message_id, user_id)
);

-- Personal labels (e.g. "Work", "Urgent").
create table public.labels (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles (id) on delete cascade,
  name     text not null check (char_length(name) between 1 and 50),
  color    text not null default '#6b7280',
  unique (user_id, name)
);

create table public.mailbox_labels (
  mailbox_id  uuid not null references public.mailbox (id) on delete cascade,
  label_id    uuid not null references public.labels (id) on delete cascade,
  primary key (mailbox_id, label_id)
);

-- Attachment info. The file itself lives in Storage at
--   attachments/<message_id>/<file name>
create table public.attachments (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages (id) on delete cascade,
  file_path   text not null,
  file_name   text not null,
  mime_type   text not null default 'application/octet-stream',
  size_bytes  bigint not null default 0,
  created_at  timestamptz not null default now()
);

-- Speed up the common lookups.
create index on public.mailbox (user_id, folder);
create index on public.messages (thread_id);
create index on public.messages (sender_id);
create index on public.message_recipients (user_id);
create index on public.attachments (message_id);


-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS used by the security rules
--    (security definer = they can look across tables without the
--     rules calling each other in a loop)
-- ---------------------------------------------------------------------

create or replace function public.is_own_draft(p_message_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.messages
    where id = p_message_id and sender_id = auth.uid() and sent_at is null
  );
$$;

create or replace function public.is_message_sender(p_message_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.messages
    where id = p_message_id and sender_id = auth.uid()
  );
$$;

-- True if I received this (already sent) message as To, Cc or Bcc.
create or replace function public.is_recipient(p_message_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.messages m
    join public.message_recipients r on r.message_id = m.id
    where m.id = p_message_id and m.sent_at is not null and r.user_id = auth.uid()
  );
$$;

create or replace function public.can_view_message(p_message_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_message_sender(p_message_id) or public.is_recipient(p_message_id);
$$;

-- True if I took part in at least one SENT message of this thread.
create or replace function public.can_see_thread(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.messages m
    where m.thread_id = p_thread_id
      and m.sent_at is not null
      and (
        m.sender_id = auth.uid()
        or exists (select 1 from public.message_recipients r
                   where r.message_id = m.id and r.user_id = auth.uid())
      )
  );
$$;

-- Reads the message id from a storage path "<message_id>/<file>".
create or replace function public.path_message_id(p_path text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_path, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. AUTOMATIC ACTIONS (triggers)
-- ---------------------------------------------------------------------

-- When you add a user in Authentication → Users, make their profile.
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
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- When a draft is created, put it in the sender's Drafts folder.
create or replace function public.handle_new_draft()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mailbox (message_id, user_id, folder, is_read)
  values (new.id, new.sender_id, 'drafts', true);
  return new;
end;
$$;

create trigger on_message_created
  after insert on public.messages
  for each row execute function public.handle_new_draft();

-- Keep updated_at fresh when a draft is edited.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger on_message_updated
  before update on public.messages
  for each row execute function public.touch_updated_at();

-- Record when something was moved to Trash (for auto-empty after 30 days).
create or replace function public.track_trash()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.folder = 'trash' and old.folder is distinct from 'trash' then
    new.trashed_at := now();
  elsif new.folder <> 'trash' then
    new.trashed_at := null;
  end if;
  return new;
end;
$$;

create trigger on_mailbox_folder_change
  before update of folder on public.mailbox
  for each row execute function public.track_trash();


-- ---------------------------------------------------------------------
-- 4. SENDING — the only way a message gets delivered.
--    The app saves a draft (with its To/Cc/Bcc), then calls this.
-- ---------------------------------------------------------------------

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

  -- Reply into an existing conversation, or start a new one.
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

  -- Sender: Drafts → Sent
  update public.mailbox set folder = 'sent', is_read = true
  where message_id = p_message_id and user_id = v_uid;

  -- Everyone in To / Cc / Bcc gets it in their Inbox.
  insert into public.mailbox (message_id, user_id, folder, is_read)
  select p_message_id, r.user_id, 'inbox', false
  from public.message_recipients r
  where r.message_id = p_message_id and r.user_id <> v_uid
  on conflict (message_id, user_id) do nothing;

  return v_thread;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. SECURITY RULES (Row Level Security)
--    The database itself decides who can see what.
-- ---------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.threads             enable row level security;
alter table public.messages            enable row level security;
alter table public.message_recipients  enable row level security;
alter table public.mailbox             enable row level security;
alter table public.labels              enable row level security;
alter table public.mailbox_labels      enable row level security;
alter table public.attachments         enable row level security;

-- Profiles: logged-in users can see the team directory, edit only themselves.
create policy "profiles: team can view" on public.profiles
  for select to authenticated using (true);
create policy "profiles: edit own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Threads: only people in the conversation.
create policy "threads: participants view" on public.threads
  for select to authenticated using (public.can_see_thread(id));

-- Messages
create policy "messages: sender or recipient can view" on public.messages
  for select to authenticated
  using (sender_id = auth.uid() or public.is_recipient(id));

create policy "messages: create own draft" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid() and sent_at is null
    and (thread_id is null or public.can_see_thread(thread_id))
  );

create policy "messages: edit own draft" on public.messages
  for update to authenticated
  using (sender_id = auth.uid() and sent_at is null)
  with check (
    sender_id = auth.uid() and sent_at is null
    and (thread_id is null or public.can_see_thread(thread_id))
  );

create policy "messages: discard own draft" on public.messages
  for delete to authenticated
  using (sender_id = auth.uid() and sent_at is null);

-- Recipients — this is what keeps Bcc secret:
--   * the sender sees everyone (To, Cc, Bcc)
--   * a recipient sees To and Cc, plus their own row
--   * nobody else ever sees the Bcc list
create policy "recipients: view (bcc hidden)" on public.message_recipients
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_message_sender(message_id)
    or (kind <> 'bcc' and public.is_recipient(message_id))
  );

create policy "recipients: add to own draft" on public.message_recipients
  for insert to authenticated with check (public.is_own_draft(message_id));
create policy "recipients: remove from own draft" on public.message_recipients
  for delete to authenticated using (public.is_own_draft(message_id));

-- Mailbox: strictly your own copies.
create policy "mailbox: view own" on public.mailbox
  for select to authenticated using (user_id = auth.uid());
create policy "mailbox: update own" on public.mailbox
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "mailbox: delete own" on public.mailbox
  for delete to authenticated using (user_id = auth.uid());

-- Labels: your own.
create policy "labels: own" on public.labels
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "mailbox_labels: own" on public.mailbox_labels
  for all to authenticated
  using (
    exists (select 1 from public.mailbox mb where mb.id = mailbox_id and mb.user_id = auth.uid())
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.mailbox mb where mb.id = mailbox_id and mb.user_id = auth.uid())
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = auth.uid())
  );

-- Attachments: visible to whoever can see the message; changeable only on your draft.
create policy "attachments: view" on public.attachments
  for select to authenticated using (public.can_view_message(message_id));
create policy "attachments: add to own draft" on public.attachments
  for insert to authenticated with check (public.is_own_draft(message_id));
create policy "attachments: remove from own draft" on public.attachments
  for delete to authenticated using (public.is_own_draft(message_id));


-- ---------------------------------------------------------------------
-- 6. PERMISSIONS — logged-out visitors get nothing; logged-in users
--    may only change the specific columns listed.
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, signature) on public.profiles to authenticated;

grant select on public.threads to authenticated;

grant select, insert, delete on public.messages to authenticated;
grant update (subject, body_html, body_text, thread_id, in_reply_to) on public.messages to authenticated;

grant select, insert, delete on public.message_recipients to authenticated;

grant select, delete on public.mailbox to authenticated;
grant update (is_read, is_starred, is_important, folder, snoozed_until) on public.mailbox to authenticated;

grant select, insert, update, delete on public.labels to authenticated;
grant select, insert, delete on public.mailbox_labels to authenticated;
grant select, insert, delete on public.attachments to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_own_draft(uuid),
  public.is_message_sender(uuid),
  public.is_recipient(uuid),
  public.can_view_message(uuid),
  public.can_see_thread(uuid),
  public.path_message_id(text),
  public.send_message(uuid)
to authenticated;


-- ---------------------------------------------------------------------
-- 7. FILE STORAGE for attachments (private, 25 MB per file)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;

create policy "attachments files: view" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments'
         and public.can_view_message(public.path_message_id(name)));

create policy "attachments files: upload to own draft" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments'
              and public.is_own_draft(public.path_message_id(name)));

create policy "attachments files: delete from own draft" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments'
         and public.is_own_draft(public.path_message_id(name)));


-- ---------------------------------------------------------------------
-- 8. LIVE UPDATES — new mail appears without refreshing
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table public.mailbox;


-- Done! You should see "Success. No rows returned".
