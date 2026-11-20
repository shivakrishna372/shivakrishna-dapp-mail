-- =====================================================================
--  DAPP Mail — Step 11: account security fixes (audit F-03/F-04/F-05)
--  * A disabled (banned) user loses access to mail at once, not when their session expires.
--  * Any password change alerts the user's verified recovery email.
-- =====================================================================

-- Active = finished first-login setup AND not disabled by an admin.
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
           (select s.first_login_completed from public.user_security s where s.user_id = auth.uid()),
           false)
     and not exists (
           select 1 from auth.users u
            where u.id = auth.uid() and u.banned_until is not null and u.banned_until > now());
$$;

-- Password changed -> email the recovery address (only for accounts that finished setup,
-- so the first-login password step does not send an alert).
create or replace function public.notify_password_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and exists (select 1 from public.user_security s
                  where s.user_id = new.id and s.first_login_completed and s.recovery_email_verified) then
    begin
      perform net.http_post(
        url     := 'https://ybckrpmjfkoyaaczwnul.supabase.co/functions/v1/recovery-email',
        body    := jsonb_build_object('action', 'notify-password-changed', 'user_id', new.id),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dapp_push_hook_secret')
        ),
        timeout_milliseconds := 5000
      );
    exception when others then
      raise warning 'notify_password_changed: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_password_changed() from public, anon, authenticated;

drop trigger if exists on_auth_password_changed on auth.users;
create trigger on_auth_password_changed
  after update of encrypted_password on auth.users
  for each row execute function public.notify_password_changed();
