-- =====================================================================
--  DAPP Mail — Step 10: addresses move from name@dapp.com to name@otsi.com
--  * Keeps a private backup of the old addresses (schema "ops", not reachable from the app).
--  * Changes the sign-in email, the sign-in identity and the profile in one transaction.
--  * Done in SQL on purpose: no confirmation emails are sent to the new addresses.
--  Undo: see the commented block at the end.
-- =====================================================================

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create table if not exists ops.email_rename_20261120 as
select u.id as user_id, u.email as auth_email, i.identity_data, p.email as profile_email, now() as saved_at
  from auth.users u
  join auth.identities i on i.user_id = u.id and i.provider = 'email'
  left join public.profiles p on p.id = u.id;
revoke all on ops.email_rename_20261120 from public, anon, authenticated;

update auth.users
   set email = regexp_replace(email, '@dapp\.com$', '@otsi.com'), updated_at = now()
 where email like '%@dapp.com';

update auth.identities
   set identity_data = jsonb_set(identity_data, '{email}',
                                 to_jsonb(regexp_replace(identity_data ->> 'email', '@dapp\.com$', '@otsi.com'))),
       updated_at = now()
 where provider = 'email' and identity_data ->> 'email' like '%@dapp.com';

update public.profiles
   set email = regexp_replace(email, '@dapp\.com$', '@otsi.com')
 where email like '%@dapp.com';

-- Undo (only if ever needed):
-- update auth.users u set email = b.auth_email from ops.email_rename_20261120 b where b.user_id = u.id;
-- update auth.identities i set identity_data = b.identity_data from ops.email_rename_20261120 b where b.user_id = i.user_id and i.provider = 'email';
-- update public.profiles p set email = b.profile_email from ops.email_rename_20261120 b where b.user_id = p.id;
