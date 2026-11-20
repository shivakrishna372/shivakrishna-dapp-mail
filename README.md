# ✉ DAPP Mail

A private, Gmail-style mail app for a small team, built with **React + Vite** and **Supabase** (free tier).
Internal only: addresses look like `name@otsi.com` (they were `name@dapp.com` until 20 Nov 2026; old addresses are still accepted when typed) and mail never leaves the app.

## Features

**Mail:** conversations (threads), To / Cc / **Bcc (truly hidden)**, rich text (bold, lists, links, quotes),
attachments up to 25 MB (drag & drop or paste), autosaving drafts, **undo send**, **schedule send**,
reply / reply all / forward (with attachments), signature.

**Organise:** Inbox, Starred, Snoozed, Important, Sent, Scheduled, Drafts, All Mail, Trash
(auto-empties after 30 days), coloured labels, **snooze**, archive, mark read/unread, bulk select,
server-side search.

**Experience:** live updates (new mail appears instantly), unread count in the tab, reading pane on wide
screens, dark mode, compact density, keyboard shortcuts (press `?`), works on phones, print.

**Admin:** add users, reset passwords, disable accounts, make admins — no need to open Supabase.

## Security model

- No public sign-up. The admin creates accounts with a temporary password.
- First sign-in forces a **verified personal recovery email** and a **new personal password**
  (the password is set on the server, so it can’t be skipped).
- Row Level Security on every table; users who haven’t finished setup can’t read or send anything.
- Bcc lists are hidden by the database itself, not just the UI.
- Mail is delivered only through the `send_message` database function, so it can’t be forged.
- “Forgot password” emails a reset link **only to the verified recovery email** — never to `@otsi.com` addresses.
- Attachments live in a private bucket and are opened through short-lived signed links.
- Every message body is sanitised (DOMPurify) before it’s shown.

## Run it

1. `npm install`
2. Copy `.env.example` to `.env.local` and paste your Supabase **publishable** key.
3. `npm run dev`

### In StackBlitz
Open `https://stackblitz.com/github/shivakrishna372/shivakrishna-dapp-mail`, add a `.env.local`
file with the two values from `.env.example`, and it starts automatically.

### Required Supabase setting (one time)
**Authentication → URL Configuration:** set **Site URL** to where the app runs
(your StackBlitz preview or Netlify URL) and add it under **Redirect URLs**.
Password-reset links only work for URLs listed there.

## Project layout

```
src/
  App.jsx              sign-in / first-login setup / app switch, theme
  MailApp.jsx          main mail screen: state, actions, shortcuts
  components/          TopBar, Sidebar, MailList, ThreadView, Composer,
                       Settings, AdminPanel, AuthScreens, TimePicker, ui
  lib/api.js           every Supabase call
  lib/utils.js         sanitising, dates, avatars
  lib/conversations.js groups messages into threads
  styles.css           design system (light + dark + mobile)
supabase/
  migrations/          database steps 01–05 (already applied)
  functions/           recovery-email, admin-users (already deployed)
```

## Free-tier notes

Supabase free: 500 MB database, 1 GB files. A project pauses after 7 days with no activity
(data is kept — restore it from the dashboard). There are no automatic backups on the free plan,
so export the database monthly (Database → Backups → or `pg_dump`).
