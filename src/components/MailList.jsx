import { useState } from 'react';
import {
  RotateCw, Archive, Trash2, MailOpen, Mail, Clock, Star, BookmarkCheck, Paperclip,
  Undo2, Inbox, Search, Send, File, CalendarClock, Tag, Sparkles,
} from 'lucide-react';
import { Checkbox, IconButton, Spinner } from './ui.jsx';
import TimePicker from './TimePicker.jsx';
import { firstName, shortDate, friendlyFuture, plural } from '../lib/utils.js';

const EMPTY = {
  inbox: { icon: Sparkles, title: 'You’re all caught up', text: 'New mail from your team will show up here.' },
  starred: { icon: Star, title: 'No starred messages', text: 'Star messages to find them here quickly.' },
  snoozed: { icon: Clock, title: 'Nothing snoozed', text: 'Snooze a conversation to bring it back later.' },
  important: { icon: BookmarkCheck, title: 'Nothing marked important', text: 'Mark conversations important to collect them here.' },
  sent: { icon: Send, title: 'No sent messages', text: 'Messages you send will appear here.' },
  scheduled: { icon: CalendarClock, title: 'Nothing scheduled', text: 'Use “Schedule send” in the compose window.' },
  drafts: { icon: File, title: 'No drafts', text: 'Unsent messages are saved here automatically.' },
  all: { icon: Inbox, title: 'No mail yet', text: 'Everything you send and receive appears here.' },
  trash: { icon: Trash2, title: 'Trash is empty', text: 'Deleted messages stay here for 30 days.' },
  label: { icon: Tag, title: 'No conversations with this label', text: 'Apply the label from an open conversation.' },
  search: { icon: Search, title: 'No results', text: 'Try different words, a name or an email address.' },
};

export default function MailList({
  view, title, conversations, loading, selected, setSelected, onOpen, me, people, labelsById,
  actions, activeKey,
}) {
  const [snoozeFor, setSnoozeFor] = useState(null); // 'bulk' | conv.key
  const keys = conversations.map((c) => c.key);
  const chosen = conversations.filter((c) => selected.has(c.key));
  const allOn = keys.length > 0 && chosen.length === keys.length;
  const isTrash = view.type === 'trash';
  const isDraftish = view.type === 'drafts' || view.type === 'scheduled';
  const canArchive = !isTrash && !isDraftish && view.type !== 'sent';

  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
  };

  const who = (c) => {
    if (isDraftish || view.type === 'sent') {
      const ids = (c.message.recipients || []).map((r) => r.user_id);
      const names = ids.map((id) => (id === me.id ? 'me' : firstName(people[id]))).filter(Boolean);
      return names.length ? `To: ${names.join(', ')}` : '(no recipients)';
    }
    const names = c.senderIds.map((id) => (id === me.id ? 'me' : firstName(people[id])));
    return names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
  };

  const Empty = EMPTY[view.type] || EMPTY.all;
  const anyUnread = chosen.some((c) => c.unread);

  return (
    <section className="list-pane">
      <div className="toolbar">
        <Checkbox
          checked={allOn}
          indeterminate={chosen.length > 0 && !allOn}
          onChange={() => setSelected(allOn ? new Set() : new Set(keys))}
          label="Select all"
        />
        {chosen.length === 0 ? (
          <>
            <IconButton icon={RotateCw} label="Refresh" onClick={actions.refresh} />
            {isTrash && conversations.length > 0 && (
              <button className="btn ghost sm" onClick={actions.emptyTrash}>Empty Trash now</button>
            )}
          </>
        ) : (
          <div className="bulk">
            {canArchive && <IconButton icon={Archive} label="Archive" onClick={() => actions.archive(chosen)} />}
            {isTrash ? (
              <>
                <IconButton icon={Undo2} label="Restore" onClick={() => actions.restore(chosen)} />
                <button className="btn ghost sm danger" onClick={() => actions.deleteForever(chosen)}>Delete forever</button>
              </>
            ) : isDraftish ? (
              <button className="btn ghost sm danger" onClick={() => actions.discardDrafts(chosen)}>Discard</button>
            ) : (
              <IconButton icon={Trash2} label="Delete" onClick={() => actions.trash(chosen)} />
            )}
            {!isDraftish && (
              <IconButton
                icon={anyUnread ? MailOpen : Mail}
                label={anyUnread ? 'Mark as read' : 'Mark as unread'}
                onClick={() => actions.markRead(chosen, anyUnread)}
              />
            )}
            {canArchive && (
              <div className="relative">
                <IconButton icon={Clock} label="Snooze" onClick={() => setSnoozeFor('bulk')} />
                <TimePicker open={snoozeFor === 'bulk'} onClose={() => setSnoozeFor(null)} title="Snooze until…" onPick={(d) => actions.snooze(chosen, d)} />
              </div>
            )}
            <span className="sel-count">{chosen.length} selected</span>
          </div>
        )}
        <span className="toolbar-spacer" />
        <span className="list-meta">{loading ? <Spinner size={16} /> : conversations.length ? plural(conversations.length, 'conversation') : ''}</span>
      </div>

      {view.type === 'trash' && conversations.length > 0 && (
        <div className="banner">Messages in Trash are deleted forever after 30 days.</div>
      )}

      <div className="list-scroll">
        {loading && conversations.length === 0 ? (
          <div className="skeletons">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton-row"><i /><i /><i /></div>)}
          </div>
        ) : conversations.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><Empty.icon size={30} /></span>
            <h3>{Empty.title}</h3>
            <p>{Empty.text}</p>
          </div>
        ) : (
          <ul className="mail-rows" role="list" aria-label={title}>
            {conversations.map((c) => {
              const m = c.message;
              const isDraft = c.folders.has('drafts');
              const isSched = c.folders.has('scheduled');
              return (
                <li
                  key={c.key}
                  className={`mail-row ${c.unread && !isDraftish ? 'unread' : ''} ${selected.has(c.key) ? 'selected' : ''} ${activeKey === c.key ? 'active' : ''}`}
                  onClick={() => onOpen(c)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(c); }}
                >
                  <Checkbox checked={selected.has(c.key)} onChange={() => toggle(c.key)} label="Select conversation" />
                  {!isDraftish && (
                    <button
                      className={`star-btn ${c.starred ? 'on' : ''}`}
                      onClick={(e) => { e.stopPropagation(); actions.star(c, !c.starred); }}
                      aria-label={c.starred ? 'Unstar' : 'Star'}
                      title={c.starred ? 'Starred' : 'Not starred'}
                    >
                      <Star size={18} fill={c.starred ? 'currentColor' : 'none'} />
                    </button>
                  )}
                  <div className="row-who">
                    {c.important && <BookmarkCheck size={14} className="imp-mark" />}
                    <span className="who-text">{who(c)}</span>
                    {c.count > 1 && <span className="row-count">{c.count}</span>}
                  </div>
                  <div className="row-main">
                    {isDraft && <span className="tag-draft">Draft</span>}
                    {isSched && <span className="tag-sched">Scheduled</span>}
                    {c.labelIds.map((id) => labelsById[id] && (
                      <span key={id} className="chip-label" style={{ '--c': labelsById[id].color }}>{labelsById[id].name}</span>
                    ))}
                    <span className="row-subject">{m.subject || '(no subject)'}</span>
                    <span className="row-snippet"> — {(m.body_text || '').replace(/\s+/g, ' ').slice(0, 160)}</span>
                  </div>
                  <div className="row-end">
                    {c.hasAttachment && <Paperclip size={15} className="clip" />}
                    <time className="row-date">
                      {isSched && m.scheduled_at
                        ? friendlyFuture(m.scheduled_at)
                        : view.type === 'snoozed' && c.snoozedUntil
                          ? friendlyFuture(c.snoozedUntil)
                          : shortDate(c.date)}
                    </time>
                    <div className="row-hover" onClick={(e) => e.stopPropagation()}>
                      {canArchive && <IconButton icon={Archive} label="Archive" onClick={() => actions.archive([c])} size={17} />}
                      {isTrash ? (
                        <IconButton icon={Undo2} label="Restore" onClick={() => actions.restore([c])} size={17} />
                      ) : isDraftish ? (
                        <IconButton icon={Trash2} label="Discard" onClick={() => actions.discardDrafts([c])} size={17} />
                      ) : (
                        <IconButton icon={Trash2} label="Delete" onClick={() => actions.trash([c])} size={17} />
                      )}
                      {!isDraftish && (
                        <IconButton icon={c.unread ? MailOpen : Mail} label={c.unread ? 'Mark as read' : 'Mark as unread'} onClick={() => actions.markRead([c], c.unread)} size={17} />
                      )}
                      {canArchive && (
                        <span className="relative">
                          <IconButton icon={Clock} label="Snooze" onClick={() => setSnoozeFor(c.key)} size={17} />
                          <TimePicker open={snoozeFor === c.key} onClose={() => setSnoozeFor(null)} title="Snooze until…" align="right" onPick={(d) => actions.snooze([c], d)} />
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
