import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Archive, Trash2, Mail, Clock, Star, BookmarkCheck, Tag, Printer, Reply, ReplyAll,
  Forward, Undo2, Inbox, Paperclip, Download, ChevronDown, FileText, Image as ImageIcon, ExternalLink,
} from 'lucide-react';
import { Avatar, IconButton, Popover, Spinner, useToast } from './ui.jsx';
import TimePicker from './TimePicker.jsx';
import * as api from '../lib/api.js';
import { sanitize, displayName, longDate, fileSize, firstName } from '../lib/utils.js';

function AttachmentCard({ att }) {
  const toast = useToast();
  const isImage = (att.mime_type || '').startsWith('image/');
  const open = async (download) => {
    try {
      const url = await api.attachmentUrl(att, download);
      window.open(url, '_blank', 'noopener');
    } catch (e) { toast(e.message, { error: true }); }
  };
  return (
    <div className="att-card">
      <span className="att-icon">{isImage ? <ImageIcon size={20} /> : <FileText size={20} />}</span>
      <div className="att-info"><b title={att.file_name}>{att.file_name}</b><small>{fileSize(att.size_bytes)}</small></div>
      {isImage && <IconButton icon={ExternalLink} label="Preview" onClick={() => open(false)} size={16} />}
      <IconButton icon={Download} label="Download" onClick={() => open(true)} size={16} />
    </div>
  );
}

function Message({ msg, me, people, expanded, onToggle, onReply, onReplyAll, onForward }) {
  const sender = people[msg.sender_id];
  const [details, setDetails] = useState(false);
  const html = useMemo(() => sanitize(msg.body_html || ''), [msg.body_html]);
  const nameOf = (id) => (id === me.id ? 'me' : displayName(people[id]));
  const byKind = (k) => (msg.recipients || []).filter((r) => r.kind === k).map((r) => r.user_id);
  const to = byKind('to'), cc = byKind('cc'), bcc = byKind('bcc');

  if (!expanded) {
    return (
      <article className="msg collapsed" onClick={onToggle}>
        <Avatar person={sender} size={32} />
        <b>{msg.sender_id === me.id ? 'me' : displayName(sender)}</b>
        <span className="msg-snippet">{(msg.body_text || '').replace(/\s+/g, ' ').slice(0, 120)}</span>
        <time>{longDate(msg.sent_at)}</time>
      </article>
    );
  }

  return (
    <article className="msg">
      <header className="msg-head">
        <Avatar person={sender} size={40} />
        <div className="msg-from" onClick={onToggle}>
          <div><b>{displayName(sender)}</b> <span className="muted">&lt;{sender?.email}&gt;</span></div>
          <button className="text-btn small" onClick={(e) => { e.stopPropagation(); setDetails(!details); }}>
            to {[...to, ...cc].map(nameOf).join(', ') || (bcc.length ? `bcc: ${bcc.map(nameOf).join(', ')}` : '')}
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="msg-tools">
          <time>{longDate(msg.sent_at)}</time>
          <IconButton icon={Reply} label="Reply" onClick={onReply} size={17} />
          <IconButton icon={ReplyAll} label="Reply all" onClick={onReplyAll} size={17} />
          <IconButton icon={Forward} label="Forward" onClick={onForward} size={17} />
        </div>
      </header>
      {details && (
        <dl className="msg-details">
          <dt>from:</dt><dd>{displayName(sender)} &lt;{sender?.email}&gt;</dd>
          {to.length > 0 && (<><dt>to:</dt><dd>{to.map((id) => people[id]?.email || 'unknown').join(', ')}</dd></>)}
          {cc.length > 0 && (<><dt>cc:</dt><dd>{cc.map((id) => people[id]?.email || 'unknown').join(', ')}</dd></>)}
          {bcc.length > 0 && (<><dt>bcc:</dt><dd>{bcc.map((id) => people[id]?.email || 'unknown').join(', ')}</dd></>)}
          <dt>date:</dt><dd>{new Date(msg.sent_at).toLocaleString()}</dd>
          <dt>security:</dt><dd>Private to DAPP Mail members on this message</dd>
        </dl>
      )}
      <div className="msg-body" dangerouslySetInnerHTML={{ __html: html }} />
      {msg.attachments?.length > 0 && (
        <div className="att-list">
          <div className="att-title"><Paperclip size={14} /> {msg.attachments.length} attachment{msg.attachments.length > 1 ? 's' : ''}</div>
          <div className="att-grid">{msg.attachments.map((a) => <AttachmentCard key={a.id} att={a} />)}</div>
        </div>
      )}
    </article>
  );
}

export default function ThreadView({
  threadId, me, people, labels, onBack, onReply, onForward, convActions, refreshToken,
}) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [labelMenu, setLabelMenu] = useState(false);
  const [snooze, setSnooze] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.loadThread(threadId);
      setData(d);
      setExpanded((prev) => {
        const next = new Set(prev);
        const unreadIds = new Set(d.rows.filter((r) => !r.is_read).map((r) => r.message_id));
        d.messages.forEach((m, i) => { if (i === d.messages.length - 1 || unreadIds.has(m.id)) next.add(m.id); });
        return next;
      });
      const unread = d.rows.filter((r) => !r.is_read).map((r) => r.id);
      if (unread.length) api.updateMailbox(unread, { is_read: true }).then(convActions.changed).catch(() => {});
    } catch (e) {
      setError(e.message);
    }
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load, refreshToken]);

  if (error) return <section className="thread-pane"><div className="empty-state"><h3>Couldn’t open this conversation</h3><p>{error}</p></div></section>;
  if (!data) return <section className="thread-pane center"><Spinner size={28} /></section>;
  if (!data.messages.length) return <section className="thread-pane"><div className="empty-state"><h3>This conversation is no longer available</h3><button className="btn ghost" onClick={onBack}>Back</button></div></section>;

  const msgById = Object.fromEntries(data.messages.map((m) => [m.id, m]));
  const rows = data.rows.map((r) => ({ ...r, message: msgById[r.message_id] }));
  const folders = new Set(rows.map((r) => r.folder));
  const inTrash = rows.length > 0 && rows.every((r) => r.folder === 'trash');
  const starred = rows.some((r) => r.is_starred);
  const important = rows.some((r) => r.is_important);
  const subject = data.messages[0].subject || '(no subject)';
  const rowLabels = new Set(rows.flatMap((r) => (r.labels || []).map((l) => l.label_id)));
  const last = data.messages[data.messages.length - 1];
  const lastReceived = [...data.messages].reverse().find((m) => m.sender_id !== me.id) || last;

  const act = async (fn, msg, back = true) => {
    try {
      await fn(rows);
      if (msg) toast(msg);
      if (back) onBack(); else load();
    } catch (e) { toast(e.message, { error: true }); }
  };

  return (
    <section className="thread-pane">
      <div className="toolbar">
        <IconButton icon={ArrowLeft} label="Back to list (u)" onClick={onBack} />
        <span className="tb-sep" />
        {inTrash ? (
          <>
            <IconButton icon={Undo2} label="Restore" onClick={() => act(convActions.restore, 'Conversation restored')} />
            <button className="btn ghost sm danger" onClick={() => act(convActions.deleteForever, 'Deleted forever')}>Delete forever</button>
          </>
        ) : (
          <>
            {folders.has('inbox') ? (
              <IconButton icon={Archive} label="Archive (e)" onClick={() => act(convActions.archive, 'Conversation archived')} />
            ) : folders.has('archive') ? (
              <IconButton icon={Inbox} label="Move to Inbox" onClick={() => act(convActions.toInbox, 'Moved to Inbox', false)} />
            ) : null}
            <IconButton icon={Trash2} label="Delete (#)" onClick={() => act(convActions.trash, 'Moved to Trash')} />
            <IconButton icon={Mail} label="Mark as unread" onClick={() => act(convActions.markUnread, 'Marked as unread')} />
            <span className="relative">
              <IconButton icon={Clock} label="Snooze" onClick={() => setSnooze(true)} />
              <TimePicker open={snooze} onClose={() => setSnooze(false)} title="Snooze until…" onPick={(d) => act((r) => convActions.snooze(r, d), 'Snoozed')} />
            </span>
          </>
        )}
        <span className="tb-sep" />
        <span className="relative">
          <IconButton icon={Tag} label="Labels" onClick={() => setLabelMenu(true)} />
          <Popover open={labelMenu} onClose={() => setLabelMenu(false)} className="label-menu">
            <div className="popover-title">Label as</div>
            {labels.length === 0 && <p className="nav-empty">No labels yet. Create one in the sidebar.</p>}
            {labels.map((l) => (
              <label key={l.id} className="menu-item check-item">
                <input
                  type="checkbox"
                  checked={rowLabels.has(l.id)}
                  onChange={(e) => act((r) => convActions.setLabel(r, l.id, e.target.checked), null, false)}
                />
                <span className="dot" style={{ background: l.color }} />
                <span>{l.name}</span>
              </label>
            ))}
          </Popover>
        </span>
        <IconButton icon={Printer} label="Print" onClick={() => window.print()} />
      </div>

      <div className="thread-scroll print-area">
        <div className="thread-title">
          <h1>{subject}</h1>
          <div className="thread-flags">
            {[...rowLabels].map((id) => {
              const l = labels.find((x) => x.id === id);
              return l ? <span key={id} className="chip-label" style={{ '--c': l.color }}>{l.name}</span> : null;
            })}
            <IconButton icon={BookmarkCheck} label={important ? 'Not important' : 'Mark important'} active={important} onClick={() => act((r) => convActions.important(r, !important), null, false)} />
            <IconButton icon={Star} label={starred ? 'Unstar' : 'Star'} active={starred} className="star-toggle" onClick={() => act((r) => convActions.star(r, !starred), null, false)} />
          </div>
        </div>

        {data.messages.map((m) => (
          <Message
            key={m.id}
            msg={m}
            me={me}
            people={people}
            expanded={expanded.has(m.id)}
            onToggle={() => setExpanded((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
            onReply={() => onReply('reply', m)}
            onReplyAll={() => onReply('all', m)}
            onForward={() => onForward(m)}
          />
        ))}

        <div className="reply-bar no-print">
          <button className="btn outline" onClick={() => onReply('reply', lastReceived)}><Reply size={16} /> Reply</button>
          {(lastReceived.recipients || []).filter((r) => r.kind !== 'bcc' && r.user_id !== me.id).length > 0 && (
            <button className="btn outline" onClick={() => onReply('all', lastReceived)}><ReplyAll size={16} /> Reply all</button>
          )}
          <button className="btn outline" onClick={() => onForward(last)}><Forward size={16} /> Forward</button>
          <span className="muted small">{data.messages.length > 1 ? `${data.messages.length} messages · ` : ''}with {[...new Set(data.messages.map((m) => m.sender_id))].map((id) => (id === me.id ? 'you' : firstName(people[id]))).join(', ')}</span>
        </div>
      </div>
    </section>
  );
}
