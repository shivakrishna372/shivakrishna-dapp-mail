// All communication with Supabase lives here.
import { supabase } from '../supabase.js';
import { safeFileName } from './utils.js';

const BUCKET = 'attachments';
const PAGE = 400;

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Calls an Edge Function and turns its JSON error into a readable message.
async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const j = await error.context?.json?.();
      if (j?.error) message = j.error;
    } catch { /* ignore */ }
    throw new Error(message || 'Request failed');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---------------- Auth & account security ----------------
export const auth = {
  signIn: (email, password) =>
    supabase.auth.signInWithPassword({ email, password }).then(({ error }) => {
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password' : error.message);
    }),
  signOut: () => supabase.auth.signOut(),
  requestReset: (email) => callFunction('recovery-email', { action: 'request-reset', email }),
  setNewPassword: (password) =>
    supabase.auth.updateUser({ password }).then(({ error }) => { if (error) throw new Error(error.message); }),
  async verifyCurrentPassword(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Current password is incorrect');
  },
  sendRecoveryCode: (recovery_email) => callFunction('recovery-email', { action: 'send', recovery_email }),
  verifyRecoveryCode: (code) => callFunction('recovery-email', { action: 'verify', code }),
  activate: (new_password) => callFunction('recovery-email', { action: 'activate', new_password }),
};

export async function loadSecurity(userId) {
  return check(
    await supabase
      .from('user_security')
      .select('user_id,recovery_email,recovery_email_verified,first_login_completed')
      .eq('user_id', userId)
      .maybeSingle()
  );
}

// ---------------- People ----------------
export async function loadProfiles() {
  return check(await supabase.from('profiles').select('id,email,username,display_name,signature,is_admin').order('display_name'));
}

export async function updateMyProfile(id, patch) {
  check(await supabase.from('profiles').update(patch).eq('id', id));
}

// ---------------- Labels ----------------
export async function loadLabels() {
  return check(await supabase.from('labels').select('id,name,color').order('name'));
}
export async function createLabel(userId, name, color) {
  return check(await supabase.from('labels').insert({ user_id: userId, name, color }).select('id,name,color').single());
}
export async function updateLabel(id, patch) {
  check(await supabase.from('labels').update(patch).eq('id', id));
}
export async function deleteLabel(id) {
  check(await supabase.from('labels').delete().eq('id', id));
}
export async function setLabel(mailboxIds, labelId, on) {
  if (!mailboxIds.length) return;
  if (on) {
    check(await supabase.from('mailbox_labels').upsert(
      mailboxIds.map((mailbox_id) => ({ mailbox_id, label_id: labelId })),
      { onConflict: 'mailbox_id,label_id', ignoreDuplicates: true }
    ));
  } else {
    check(await supabase.from('mailbox_labels').delete().eq('label_id', labelId).in('mailbox_id', mailboxIds));
  }
}

// ---------------- Mail lists ----------------
const LIST_SELECT = `
  id,folder,is_read,is_starred,is_important,snoozed_until,created_at,
  labels:mailbox_labels(label_id),
  message:messages!inner(
    id,thread_id,subject,body_text,sent_at,scheduled_at,created_at,updated_at,sender_id,
    recipients:message_recipients(user_id,kind),
    attachments(id)
  )`;

export async function listMailbox(userId, view) {
  let q = supabase.from('mailbox').select(LIST_SELECT).eq('user_id', userId);

  switch (view.type) {
    case 'inbox': q = q.eq('folder', 'inbox').is('snoozed_until', null); break;
    case 'starred': q = q.eq('is_starred', true).neq('folder', 'trash'); break;
    case 'snoozed': q = q.not('snoozed_until', 'is', null).neq('folder', 'trash'); break;
    case 'important': q = q.eq('is_important', true).neq('folder', 'trash'); break;
    case 'sent': q = q.eq('folder', 'sent'); break;
    case 'scheduled': q = q.eq('folder', 'scheduled'); break;
    case 'drafts': q = q.eq('folder', 'drafts'); break;
    case 'all': q = q.in('folder', ['inbox', 'sent', 'archive']); break;
    case 'trash': q = q.eq('folder', 'trash'); break;
    case 'label': {
      const ids = check(await supabase.from('mailbox_labels').select('mailbox_id').eq('label_id', view.id)).map((r) => r.mailbox_id);
      if (!ids.length) return [];
      q = q.in('id', ids).neq('folder', 'trash');
      break;
    }
    case 'search': {
      return check(await supabase.rpc('search_mailbox', { p_query: view.q }).select(LIST_SELECT));
    }
    default: break;
  }
  return check(await q.order('created_at', { ascending: false }).limit(PAGE));
}

export async function loadCounts(userId) {
  const count = async (build) => {
    const { count: c, error } = await build(supabase.from('mailbox').select('id', { count: 'exact', head: true }).eq('user_id', userId));
    if (error) throw new Error(error.message);
    return c || 0;
  };
  const [inbox, drafts, scheduled, snoozed] = await Promise.all([
    count((q) => q.eq('folder', 'inbox').eq('is_read', false).is('snoozed_until', null)),
    count((q) => q.eq('folder', 'drafts')),
    count((q) => q.eq('folder', 'scheduled')),
    count((q) => q.not('snoozed_until', 'is', null).neq('folder', 'trash')),
  ]);
  return { inbox, drafts, scheduled, snoozed };
}

// All of my mailbox rows for the given conversations (used for "trash whole conversation").
export async function myRowsForThreads(userId, threadIds) {
  if (!threadIds.length) return [];
  return check(
    await supabase
      .from('mailbox')
      .select('id,folder,message:messages!inner(thread_id,sender_id)')
      .eq('user_id', userId)
      .in('message.thread_id', threadIds)
  );
}

export async function updateMailbox(ids, patch) {
  if (!ids.length) return;
  check(await supabase.from('mailbox').update(patch).in('id', ids));
}

export async function deleteMailbox(ids) {
  if (!ids.length) return;
  check(await supabase.from('mailbox').delete().in('id', ids));
}

// ---------------- Conversation ----------------
export async function loadThread(threadId) {
  const messages = check(
    await supabase
      .from('messages')
      .select(`id,thread_id,subject,body_html,body_text,sent_at,created_at,sender_id,in_reply_to,
        recipients:message_recipients(user_id,kind),
        attachments(id,file_name,file_path,size_bytes,mime_type)`)
      .eq('thread_id', threadId)
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: true })
  );
  const ids = messages.map((m) => m.id);
  const rows = ids.length
    ? check(
        await supabase
          .from('mailbox')
          .select('id,message_id,folder,is_read,is_starred,is_important,snoozed_until,labels:mailbox_labels(label_id)')
          .in('message_id', ids)
      )
    : [];
  return { messages, rows };
}

export async function loadDraft(messageId) {
  return check(
    await supabase
      .from('messages')
      .select(`id,thread_id,in_reply_to,subject,body_html,scheduled_at,
        recipients:message_recipients(user_id,kind),
        attachments(id,file_name,file_path,size_bytes,mime_type)`)
      .eq('id', messageId)
      .single()
  );
}

// ---------------- Drafts & sending ----------------
export async function createDraft(userId, fields) {
  return check(
    await supabase.from('messages').insert({ sender_id: userId, ...fields }).select('id').single()
  ).id;
}

export async function updateDraft(id, fields) {
  check(await supabase.from('messages').update(fields).eq('id', id));
}

export async function setRecipients(messageId, { to, cc, bcc }) {
  check(await supabase.from('message_recipients').delete().eq('message_id', messageId));
  const seen = new Set();
  const rows = [];
  for (const [kind, list] of [['to', to], ['cc', cc], ['bcc', bcc]]) {
    for (const user_id of list) {
      if (seen.has(user_id)) continue;
      seen.add(user_id);
      rows.push({ message_id: messageId, user_id, kind });
    }
  }
  if (rows.length) check(await supabase.from('message_recipients').insert(rows));
}

export async function discardDraft(messageId, attachments = []) {
  if (attachments.length) {
    await supabase.storage.from(BUCKET).remove(attachments.map((a) => a.file_path));
  }
  check(await supabase.from('messages').delete().eq('id', messageId));
}

export async function sendMessage(messageId, sendAt = null) {
  return check(await supabase.rpc('send_message', { p_message_id: messageId, p_send_at: sendAt }));
}

export async function cancelScheduled(messageId) {
  check(await supabase.rpc('cancel_scheduled', { p_message_id: messageId }));
}

// ---------------- Attachments ----------------
export const MAX_FILE = 25 * 1024 * 1024;

export async function uploadAttachment(messageId, file) {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is larger than 25 MB`);
  const path = `${messageId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (up.error) throw new Error(up.error.message);
  return check(
    await supabase
      .from('attachments')
      .insert({ message_id: messageId, file_path: path, file_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size })
      .select('id,file_name,file_path,size_bytes,mime_type')
      .single()
  );
}

export async function copyAttachment(messageId, att) {
  const path = `${messageId}/${crypto.randomUUID()}-${safeFileName(att.file_name)}`;
  const cp = await supabase.storage.from(BUCKET).copy(att.file_path, path);
  if (cp.error) throw new Error(cp.error.message);
  return check(
    await supabase
      .from('attachments')
      .insert({ message_id: messageId, file_path: path, file_name: att.file_name, mime_type: att.mime_type, size_bytes: att.size_bytes })
      .select('id,file_name,file_path,size_bytes,mime_type')
      .single()
  );
}

export async function removeAttachment(att) {
  await supabase.storage.from(BUCKET).remove([att.file_path]);
  check(await supabase.from('attachments').delete().eq('id', att.id));
}

export async function attachmentUrl(att, download = true) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(att.file_path, 120, download ? { download: att.file_name } : undefined);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ---------------- Admin ----------------
export const adminApi = (action, body = {}) => callFunction('admin-users', { action, ...body });

// ---------------- Live updates ----------------
export function subscribeMailbox(userId, onChange) {
  const channel = supabase
    .channel(`mailbox-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mailbox', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
