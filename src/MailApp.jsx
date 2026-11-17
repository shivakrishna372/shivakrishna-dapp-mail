import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import TopBar from './components/TopBar.jsx';
import Sidebar, { FOLDERS } from './components/Sidebar.jsx';
import MailList from './components/MailList.jsx';
import ThreadView from './components/ThreadView.jsx';
import Composer from './components/Composer.jsx';
import Settings, { ShortcutList } from './components/Settings.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { Modal, Spinner, useToast } from './components/ui.jsx';
import * as api from './lib/api.js';
import { groupConversations } from './lib/conversations.js';
import { sanitize, textToHtml, displayName, escapeHtml, friendlyFuture } from './lib/utils.js';

const UNDO_MS = 5000;

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export default function MailApp({ user, security, theme, setTheme }) {
  const toast = useToast();
  const [people, setPeople] = useState([]);
  const [labels, setLabels] = useState([]);
  const [counts, setCounts] = useState({ inbox: 0, drafts: 0, scheduled: 0, snoozed: 0 });
  const [view, setViewState] = useState({ type: 'inbox' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(null); // { threadId, key }
  const [composers, setComposers] = useState([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [collapsed, setCollapsed] = useState(readPref('dapp-sidebar', '') === 'collapsed');
  const [mobileNav, setMobileNav] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [density, setDensityState] = useState(readPref('dapp-density', 'comfortable'));
  const searchRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const labelsById = useMemo(() => Object.fromEntries(labels.map((l) => [l.id, l])), [labels]);
  const me = peopleById[user.id] || { id: user.id, email: user.email, display_name: user.email.split('@')[0] };

  const setDensity = (d) => { setDensityState(d); writePref('dapp-density', d); };
  const setView = useCallback((v) => {
    setViewState(v); setOpen(null); setSelected(new Set());
  }, []);

  // ---------------- Loading ----------------
  const loadPeople = useCallback(() => api.loadProfiles().then(setPeople).catch((e) => toast(e.message, { error: true })), [toast]);
  const loadLabels = useCallback(() => api.loadLabels().then(setLabels).catch(() => {}), []);
  const loadCounts = useCallback(() => api.loadCounts(user.id).then(setCounts).catch(() => {}), [user.id]);

  const reload = useCallback(async (quiet = false) => {
    const v = viewRef.current;
    if (v.type === 'settings' || v.type === 'admin') return;
    if (!quiet) setLoading(true);
    try {
      const data = await api.listMailbox(user.id, v);
      if (viewRef.current === v) setRows(data);
    } catch (e) {
      toast(e.message, { error: true });
    }
    setLoading(false);
    loadCounts();
  }, [user.id, toast, loadCounts]);

  useEffect(() => { loadPeople(); loadLabels(); }, [loadPeople, loadLabels]);
  useEffect(() => { setRows([]); reload(); }, [view, reload]);

  // Live updates: new mail appears without refreshing.
  useEffect(() => {
    let t;
    const unsub = api.subscribeMailbox(user.id, (payload) => {
      clearTimeout(t);
      t = setTimeout(() => { reload(true); setRefreshToken((x) => x + 1); }, 400);
      if (payload.eventType === 'INSERT' && payload.new?.folder === 'inbox') {
        toast('New message received');
      }
    });
    return () => { clearTimeout(t); unsub(); };
  }, [user.id, reload, toast]);

  // Tab title with unread count.
  useEffect(() => {
    const label = view.type === 'label' ? labelsById[view.id]?.name
      : view.type === 'search' ? 'Search results'
      : FOLDERS.find((f) => f.type === view.type)?.label || 'DAPP Mail';
    document.title = `${label}${counts.inbox ? ` (${counts.inbox})` : ''} - DAPP Mail`;
  }, [view, counts.inbox, labelsById]);

  const conversations = useMemo(() => groupConversations(rows, view), [rows, view]);

  // ---------------- Conversation actions ----------------
  const changed = useCallback(() => { reload(true); }, [reload]);
  const ids = (rs, pred = () => true) => rs.filter(pred).map((r) => r.id);
  const rowsOf = (convs) => convs.flatMap((c) => c.rows);
  const allRowsOf = async (convs) => {
    const threadIds = convs.map((c) => c.threadId).filter(Boolean);
    const extra = await api.myRowsForThreads(user.id, threadIds);
    const map = new Map([...rowsOf(convs), ...extra].map((r) => [r.id, r]));
    return [...map.values()];
  };

  const rowActions = {
    archive: (rs) => api.updateMailbox(ids(rs, (r) => r.folder === 'inbox'), { folder: 'archive', snoozed_until: null }),
    toInbox: (rs) => api.updateMailbox(ids(rs, (r) => r.folder === 'archive'), { folder: 'inbox' }),
    trash: (rs) => api.updateMailbox(ids(rs, (r) => r.folder !== 'trash' && r.folder !== 'drafts' && r.folder !== 'scheduled'), { folder: 'trash', snoozed_until: null }),
    restore: async (rs) => {
      const trash = rs.filter((r) => r.folder === 'trash');
      await api.updateMailbox(ids(trash, (r) => r.message?.sender_id === user.id), { folder: 'sent' });
      await api.updateMailbox(ids(trash, (r) => r.message?.sender_id !== user.id), { folder: 'inbox' });
    },
    deleteForever: (rs) => api.deleteMailbox(ids(rs, (r) => r.folder === 'trash')),
    markUnread: (rs) => api.updateMailbox(ids(rs, (r) => r.folder !== 'sent'), { is_read: false }),
    star: (rs, on) => on
      ? api.updateMailbox([rs[rs.length - 1]?.id].filter(Boolean), { is_starred: true })
      : api.updateMailbox(ids(rs), { is_starred: false }),
    important: (rs, on) => api.updateMailbox(ids(rs), { is_important: on }),
    snooze: (rs, date) => api.updateMailbox(ids(rs, (r) => r.folder === 'inbox'), { snoozed_until: date.toISOString() }),
    setLabel: (rs, labelId, on) => api.setLabel(ids(rs), labelId, on),
  };

  const convActions = { ...rowActions, changed };

  const guard = async (fn, msg, undo) => {
    try {
      await fn();
      setSelected(new Set());
      if (msg) toast(msg, undo ? { action: { label: 'Undo', onClick: undo } } : {});
      reload(true);
    } catch (e) { toast(e.message, { error: true }); }
  };

  const listActions = {
    refresh: () => reload(),
    archive: (convs) => {
      const rs = rowsOf(convs).filter((r) => r.folder === 'inbox');
      guard(() => rowActions.archive(rs), convs.length > 1 ? `${convs.length} conversations archived` : 'Conversation archived',
        () => api.updateMailbox(ids(rs), { folder: 'inbox' }).then(changed));
    },
    trash: async (convs) => {
      const rs = (await allRowsOf(convs)).filter((r) => !['trash', 'drafts', 'scheduled'].includes(r.folder));
      const before = rs.map((r) => [r.id, r.folder]);
      guard(() => rowActions.trash(rs), convs.length > 1 ? `${convs.length} conversations moved to Trash` : 'Conversation moved to Trash',
        async () => { for (const [id, folder] of before) await api.updateMailbox([id], { folder }); changed(); });
    },
    restore: (convs) => guard(() => rowActions.restore(rowsOf(convs)), 'Restored'),
    deleteForever: (convs) => {
      if (!window.confirm(`Delete ${convs.length === 1 ? 'this conversation' : `${convs.length} conversations`} forever? This can’t be undone.`)) return;
      guard(() => rowActions.deleteForever(rowsOf(convs)), 'Deleted forever');
    },
    emptyTrash: () => {
      if (!window.confirm('Delete everything in Trash forever? This can’t be undone.')) return;
      guard(() => api.deleteMailbox(ids(rows, (r) => r.folder === 'trash')), 'Trash emptied');
    },
    markRead: (convs, read) => guard(() => api.updateMailbox(ids(rowsOf(convs)), { is_read: read })),
    star: (conv, on) => guard(() => rowActions.star(conv.rows.slice().reverse(), on)),
    snooze: (convs, date) => guard(() => rowActions.snooze(rowsOf(convs), date), `Snoozed until ${friendlyFuture(date)}`),
    discardDrafts: (convs) => guard(async () => {
      for (const c of convs) {
        const d = await api.loadDraft(c.message.id).catch(() => null);
        await api.discardDraft(c.message.id, d?.attachments || []);
      }
    }, convs.length > 1 ? 'Drafts discarded' : 'Draft discarded'),
  };

  // ---------------- Compose ----------------
  const signatureHtml = () => (me.signature ? `<div class="signature">-- <br>${textToHtml(me.signature)}</div>` : '');

  const openComposer = useCallback((initial) => {
    setComposers((list) => {
      if (initial.draftId && list.some((c) => c.initial.draftId === initial.draftId)) return list;
      const next = [...list, { id: Math.random().toString(36).slice(2), initial }];
      return next.slice(-3);
    });
  }, []);
  const closeComposer = (id) => setComposers((list) => list.filter((c) => c.id !== id));

  const compose = () => openComposer({ to: [], html: me.signature ? `<br><br>${signatureHtml()}` : '' });

  const quoteBlock = (msg) => {
    const s = peopleById[msg.sender_id];
    const when = new Date(msg.sent_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    return `<div class="quote">On ${escapeHtml(when)}, ${escapeHtml(displayName(s))} &lt;${escapeHtml(s?.email || '')}&gt; wrote:<blockquote>${sanitize(msg.body_html)}</blockquote></div>`;
  };

  const reply = (mode, msg) => {
    const visible = (msg.recipients || []).filter((r) => r.kind !== 'bcc');
    const mine = msg.sender_id === user.id;
    const to = mine ? visible.filter((r) => r.kind === 'to').map((r) => r.user_id) : [msg.sender_id];
    const cc = mode === 'all'
      ? visible.map((r) => r.user_id).filter((id) => id !== user.id && !to.includes(id))
      : [];
    const subj = msg.subject || '';
    openComposer({
      to: to.filter((id) => id !== user.id || mine),
      cc,
      subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`,
      html: `<br>${me.signature ? `<br>${signatureHtml()}` : ''}<br>${quoteBlock(msg)}`,
      threadId: msg.thread_id,
      inReplyTo: msg.id,
      focus: 'body',
    });
  };

  const forward = (msg) => {
    const s = peopleById[msg.sender_id];
    const subj = msg.subject || '';
    const header = `---------- Forwarded message ----------<br>From: ${escapeHtml(displayName(s))} &lt;${escapeHtml(s?.email || '')}&gt;<br>Date: ${escapeHtml(new Date(msg.sent_at).toLocaleString())}<br>Subject: ${escapeHtml(subj)}<br><br>`;
    openComposer({
      to: [],
      subject: /^fwd:/i.test(subj) ? subj : `Fwd: ${subj}`,
      html: `<br>${me.signature ? `<br>${signatureHtml()}` : ''}<br><div class="forwarded">${header}${sanitize(msg.body_html)}</div>`,
      forwardAttachments: msg.attachments || [],
    });
  };

  const sendWithUndo = (draftId, reopen) => {
    let cancelled = false;
    const toastId = toast('Sending…', {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => { cancelled = true; openComposer(reopen); toast('Sending cancelled — draft reopened'); } },
    });
    setTimeout(async () => {
      if (cancelled) return;
      toast.dismiss?.(toastId);
      try {
        await api.sendMessage(draftId);
        toast('Message sent');
        reload(true);
        setRefreshToken((x) => x + 1);
      } catch (e) {
        toast(`Not sent: ${e.message}`, { error: true });
        openComposer(reopen);
      }
    }, UNDO_MS);
  };

  const schedule = async (draftId, when, reopen) => {
    try {
      await api.sendMessage(draftId, when.toISOString());
      toast(`Scheduled for ${friendlyFuture(when)}`, {
        action: {
          label: 'Undo',
          onClick: async () => { await api.cancelScheduled(draftId).catch(() => {}); openComposer({ ...reopen, scheduledAt: null }); reload(true); },
        },
      });
      reload(true);
    } catch (e) {
      toast(e.message, { error: true });
      openComposer(reopen);
    }
  };

  const openConversation = async (c) => {
    const folder = c.latest.folder;
    if (folder === 'drafts' || folder === 'scheduled') {
      try {
        const d = await api.loadDraft(c.message.id);
        const by = (k) => (d.recipients || []).filter((r) => r.kind === k).map((r) => r.user_id);
        openComposer({
          draftId: d.id, threadId: d.thread_id, inReplyTo: d.in_reply_to, to: by('to'), cc: by('cc'), bcc: by('bcc'),
          subject: d.subject, html: d.body_html, attachments: d.attachments || [], scheduledAt: d.scheduled_at,
        });
      } catch (e) { toast(e.message, { error: true }); }
      return;
    }
    if (c.threadId) setOpen({ threadId: c.threadId, key: c.key });
  };

  // ---------------- Labels ----------------
  const labelOps = {
    onCreateLabel: async (v) => { try { await api.createLabel(user.id, v.name, v.color); loadLabels(); toast(`Label “${v.name}” created`); } catch (e) { toast(e.message.includes('duplicate') ? 'A label with that name already exists' : e.message, { error: true }); throw e; } },
    onEditLabel: async (l, v) => { try { await api.updateLabel(l.id, v); loadLabels(); } catch (e) { toast(e.message, { error: true }); throw e; } },
    onDeleteLabel: async (l) => {
      if (!window.confirm(`Delete the label “${l.name}”? Conversations stay in your mail.`)) return;
      try { await api.deleteLabel(l.id); loadLabels(); if (view.type === 'label' && view.id === l.id) setView({ type: 'inbox' }); reload(true); }
      catch (e) { toast(e.message, { error: true }); }
    },
  };

  // ---------------- Keyboard shortcuts ----------------
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    let gPressed = false;
    let gTimer;
    const onKey = (e) => {
      const t = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (document.querySelector('.modal-backdrop')) return;
      const k = e.key;
      if (gPressed) {
        gPressed = false;
        const map = { i: 'inbox', s: 'starred', t: 'sent', d: 'drafts', a: 'all' };
        if (map[k]) { e.preventDefault(); setView({ type: map[k] }); }
        return;
      }
      if (k === 'g') { gPressed = true; clearTimeout(gTimer); gTimer = setTimeout(() => { gPressed = false; }, 1200); return; }
      if (k === 'c') { e.preventDefault(); compose(); }
      else if (k === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (k === '?') { e.preventDefault(); setShowKeys(true); }
      else if (openRef.current) {
        const root = document.querySelector('.thread-pane');
        const click = (label) => root?.querySelector(`[aria-label^="${label}"]`)?.click();
        if (k === 'u') setOpen(null);
        else if (k === 'e') click('Archive');
        else if (k === '#') click('Delete');
        else if (k === 'r') root?.querySelector('.reply-bar .btn')?.click();
        else if (k === 'a') [...(root?.querySelectorAll('.reply-bar .btn') || [])].find((b) => b.textContent.includes('Reply all'))?.click();
        else if (k === 'f') [...(root?.querySelectorAll('.reply-bar .btn') || [])].find((b) => b.textContent.includes('Forward'))?.click();
        else if (k === 's') root?.querySelector('.star-toggle')?.click();
        else if (k === 'U') click('Mark as unread');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(gTimer); };
  }); // re-bind each render so handlers see fresh state

  const doSearch = (q) => {
    if (q) setView({ type: 'search', q });
    else if (view.type === 'search') setView({ type: 'inbox' });
  };

  const title = view.type === 'label' ? labelsById[view.id]?.name || 'Label'
    : view.type === 'search' ? `Results for “${view.q}”`
    : FOLDERS.find((f) => f.type === view.type)?.label || '';

  const toggleMenu = () => {
    if (window.matchMedia('(max-width: 860px)').matches) setMobileNav(true);
    else { const c = !collapsed; setCollapsed(c); writePref('dapp-sidebar', c ? 'collapsed' : ''); }
  };

  if (!people.length) {
    return <div className="boot"><Spinner size={28} /><span>Loading your mail…</span></div>;
  }

  return (
    <div className={`app density-${density}`}>
      <TopBar
        ref={searchRef}
        me={me}
        onMenu={toggleMenu}
        onSearch={doSearch}
        searchValue={view.type === 'search' ? view.q : ''}
        onSettings={() => setView({ type: 'settings' })}
        onShortcuts={() => setShowKeys(true)}
        onSignOut={() => api.auth.signOut()}
        theme={theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme}
        onToggleTheme={() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')}
        onHome={() => setView({ type: 'inbox' })}
      />
      <div className="body">
        <Sidebar
          view={view}
          setView={setView}
          counts={counts}
          labels={labels}
          onCompose={compose}
          collapsed={collapsed}
          mobileOpen={mobileNav}
          onCloseMobile={() => setMobileNav(false)}
          isAdmin={!!me.is_admin}
          {...labelOps}
        />
        <main className={`main ${open ? 'has-open' : ''}`}>
          {view.type === 'settings' ? (
            <Settings
              me={me}
              security={security}
              onBack={() => setView({ type: 'inbox' })}
              onProfileSaved={loadPeople}
              theme={theme}
              setTheme={setTheme}
              density={density}
              setDensity={setDensity}
            />
          ) : view.type === 'admin' && me.is_admin ? (
            <AdminPanel me={me} onBack={() => setView({ type: 'inbox' })} onUsersChanged={loadPeople} />
          ) : (
            <>
              <MailList
                view={view}
                title={title}
                conversations={conversations}
                loading={loading}
                selected={selected}
                setSelected={setSelected}
                onOpen={openConversation}
                me={me}
                people={peopleById}
                labelsById={labelsById}
                actions={listActions}
                activeKey={open?.key}
              />
              {open && (
                <ThreadView
                  key={open.threadId}
                  threadId={open.threadId}
                  me={me}
                  people={peopleById}
                  labels={labels}
                  onBack={() => { setOpen(null); reload(true); }}
                  onReply={reply}
                  onForward={forward}
                  convActions={convActions}
                  refreshToken={refreshToken}
                />
              )}
            </>
          )}
        </main>
      </div>

      <button className="fab" onClick={compose} aria-label="Compose"><Pencil size={22} /></button>

      <div className="composer-dock">
        {composers.map((c) => (
          <Composer
            key={c.id}
            initial={c.initial}
            me={me}
            people={people}
            onClose={() => closeComposer(c.id)}
            onSend={sendWithUndo}
            onSchedule={schedule}
            onChanged={changed}
          />
        ))}
      </div>

      {showKeys && (
        <Modal title="Keyboard shortcuts" onClose={() => setShowKeys(false)} width={560}>
          <ShortcutList />
        </Modal>
      )}
    </div>
  );
}
