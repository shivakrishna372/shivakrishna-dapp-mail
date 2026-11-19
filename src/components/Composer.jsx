import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Minus, Maximize2, Minimize2, Trash2, Paperclip, ChevronDown, Bold, Italic, Underline,
  Strikethrough, List, ListOrdered, Quote, Link2, RemoveFormatting, CalendarClock, FileText, Loader2,
} from 'lucide-react';
import { Avatar, IconButton, Popover, useToast } from './ui.jsx';
import TimePicker from './TimePicker.jsx';
import * as api from '../lib/api.js';
import { sanitize, htmlToText, displayName, fileSize, friendlyFuture, DOMAIN } from '../lib/utils.js';

// ---------------- Recipient chips with autocomplete ----------------
function RecipientField({ label, ids, setIds, people, exclude, autoFocus, extra }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [warn, setWarn] = useState('');
  const inputRef = useRef(null);

  const suggestions = useMemo(() => {
    const t = text.trim().toLowerCase();
    return people
      .filter((p) => !ids.includes(p.id) && !exclude.includes(p.id))
      .filter((p) => !t || p.email.includes(t) || (p.display_name || '').toLowerCase().includes(t))
      .slice(0, 6);
  }, [text, people, ids, exclude]);

  const add = (p) => { setIds([...ids, p.id]); setText(''); setHi(0); setWarn(''); inputRef.current?.focus(); };

  const commitText = () => {
    const t = text.trim().toLowerCase().replace(/[,;]$/, '');
    if (!t) return;
    const addr = t.includes('@') ? t : `${t}@${DOMAIN}`;
    const match = people.find((p) => p.email === addr || p.username === t);
    if (match && !ids.includes(match.id)) add(match);
    else if (!match) setWarn(`“${t}” isn’t a DAPP Mail user`);
  };

  const onKey = (e) => {
    if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') && text.trim()) {
      e.preventDefault();
      if (open && suggestions[hi]) add(suggestions[hi]); else commitText();
    } else if (e.key === 'Backspace' && !text && ids.length) {
      setIds(ids.slice(0, -1));
    } else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, suggestions.length - 1)); setOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };

  const onPaste = (e) => {
    const raw = e.clipboardData.getData('text');
    if (!/[,;\s]/.test(raw)) return;
    e.preventDefault();
    const found = [];
    raw.split(/[,;\s]+/).forEach((tok) => {
      const t = tok.trim().toLowerCase();
      const p = people.find((x) => x.email === t || x.username === t);
      if (p && !ids.includes(p.id) && !found.includes(p.id)) found.push(p.id);
    });
    setIds([...ids, ...found]);
  };

  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  return (
    <div className="rcpt-row" onClick={() => inputRef.current?.focus()}>
      <span className="rcpt-label">{label}</span>
      <div className="rcpt-chips">
        {ids.map((id) => (
          <span key={id} className="chip" title={byId[id]?.email}>
            <Avatar person={byId[id]} size={20} />
            {displayName(byId[id])}
            <button type="button" onClick={(e) => { e.stopPropagation(); setIds(ids.filter((x) => x !== id)); }} aria-label={`Remove ${displayName(byId[id])}`}><X size={12} /></button>
          </span>
        ))}
        <div className="relative grow">
          <input
            ref={inputRef}
            value={text}
            autoFocus={autoFocus}
            onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); setWarn(''); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => { setOpen(false); commitText(); }, 150)}
            onKeyDown={onKey}
            onPaste={onPaste}
            aria-label={`${label} recipients`}
            spellCheck={false}
          />
          {open && suggestions.length > 0 && (
            <div className="suggest">
              {suggestions.map((p, i) => (
                <button type="button" key={p.id} className={`suggest-item ${i === hi ? 'hi' : ''}`} onMouseDown={(e) => { e.preventDefault(); add(p); }}>
                  <Avatar person={p} size={30} />
                  <span><b>{displayName(p)}</b><small>{p.email}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {extra}
      {warn && <div className="rcpt-warn">{warn}</div>}
    </div>
  );
}

// ---------------- Rich text editor ----------------
function FormatBar({ editorRef, onChange }) {
  const run = (cmd, val) => { editorRef.current?.focus(); document.execCommand(cmd, false, val); onChange(); };
  const btn = (Icon, label, cmd, val) => (
    <button type="button" className="fmt-btn" title={label} aria-label={label} onMouseDown={(e) => { e.preventDefault(); run(cmd, val); }}>
      <Icon size={16} />
    </button>
  );
  return (
    <div className="fmt-bar">
      {btn(Bold, 'Bold (Ctrl+B)', 'bold')}
      {btn(Italic, 'Italic (Ctrl+I)', 'italic')}
      {btn(Underline, 'Underline (Ctrl+U)', 'underline')}
      {btn(Strikethrough, 'Strikethrough', 'strikeThrough')}
      <span className="fmt-sep" />
      {btn(List, 'Bulleted list', 'insertUnorderedList')}
      {btn(ListOrdered, 'Numbered list', 'insertOrderedList')}
      {btn(Quote, 'Quote', 'formatBlock', 'blockquote')}
      <button
        type="button"
        className="fmt-btn"
        title="Insert link"
        aria-label="Insert link"
        onMouseDown={(e) => {
          e.preventDefault();
          const url = window.prompt('Link address (https://…)');
          if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) run('createLink', url.trim());
        }}
      >
        <Link2 size={16} />
      </button>
      {btn(RemoveFormatting, 'Remove formatting', 'removeFormat')}
    </div>
  );
}

// ---------------- Compose window ----------------
export default function Composer({ initial, me, people, onClose, onSend, onSchedule, onChanged }) {
  const toast = useToast();
  const [to, setTo] = useState(initial.to || []);
  const [cc, setCc] = useState(initial.cc || []);
  const [bcc, setBcc] = useState(initial.bcc || []);
  const [showCc, setShowCc] = useState((initial.cc || []).length > 0);
  const [showBcc, setShowBcc] = useState((initial.bcc || []).length > 0);
  const [subject, setSubject] = useState(initial.subject || '');
  const [html, setHtml] = useState(initial.html || '');
  const [attachments, setAttachments] = useState(initial.attachments || []);
  const [uploading, setUploading] = useState([]);
  const [status, setStatus] = useState(initial.draftId ? 'Draft' : '');
  const [mode, setMode] = useState('normal'); // normal | min | max
  const [sendMenu, setSendMenu] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const draftId = useRef(initial.draftId || null);
  const chain = useRef(Promise.resolve());
  // For an existing draft, its recipients are already saved. For a new message (incl. Reply /
  // Reply all, which pre-fill To/Cc) nothing is saved yet, so the first save must write them.
  const lastRecipients = useRef(
    initial.draftId ? JSON.stringify([initial.to || [], initial.cc || [], initial.bcc || []]) : JSON.stringify([[], [], []])
  );
  const dirty = useRef(false);
  const closed = useRef(false);
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const typed = useRef(false);

  // Put initial HTML into the editor once.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = sanitize(initial.html || '');
    if (initial.focus === 'body' && editorRef.current) {
      editorRef.current.focus();
      const sel = window.getSelection();
      sel.collapse(editorRef.current, 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasContent = () =>
    subject.trim() || htmlToText(html).trim() || to.length || cc.length || bcc.length || attachments.length;

  // Serialised save so two saves never race.
  const save = useCallback(() => {
    chain.current = chain.current.then(async () => {
      if (!draftId.current && !hasContent()) return draftId.current;
      const clean = sanitize(html);
      const fields = {
        subject: subject.slice(0, 250),
        body_html: clean,
        body_text: htmlToText(clean),
        thread_id: initial.threadId || null,
        in_reply_to: initial.inReplyTo || null,
      };
      setStatus('Saving…');
      if (!draftId.current) {
        draftId.current = await api.createDraft(me.id, fields);
        // Copy attachments when forwarding.
        if (initial.forwardAttachments?.length) {
          const copied = [];
          for (const a of initial.forwardAttachments) {
            try { copied.push(await api.copyAttachment(draftId.current, a)); } catch (e) { toast(`Couldn’t attach ${a.file_name}: ${e.message}`, { error: true }); }
          }
          setAttachments((x) => [...x, ...copied]);
        }
      } else {
        await api.updateDraft(draftId.current, fields);
      }
      const r = JSON.stringify([to, cc, bcc]);
      if (r !== lastRecipients.current) {
        await api.setRecipients(draftId.current, { to, cc, bcc });
        lastRecipients.current = r;
      }
      dirty.current = false;
      setStatus('Draft saved');
      return draftId.current;
    }).catch((e) => { setStatus('Not saved'); toast(e.message, { error: true }); return draftId.current; });
    return chain.current;
  }, [html, subject, to, cc, bcc, attachments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave 1.2 s after the last change.
  useEffect(() => {
    if (closed.current) return;
    dirty.current = true;
    const t = setTimeout(() => { if (!closed.current) save(); }, 1200);
    return () => clearTimeout(t);
  }, [html, subject, to, cc, bcc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Forwarding: create the draft straight away so attachments get copied.
  useEffect(() => { if (initial.forwardAttachments?.length) save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (files) => {
    const list = [...files];
    if (!list.length) return;
    const id = await save() || (await (async () => { draftId.current = await api.createDraft(me.id, { subject, body_html: sanitize(html), body_text: htmlToText(html) }); return draftId.current; })());
    for (const f of list) {
      const tmp = { tmp: Math.random(), file_name: f.name, size_bytes: f.size };
      setUploading((u) => [...u, tmp]);
      try {
        const att = await api.uploadAttachment(id, f);
        setAttachments((a) => [...a, att]);
      } catch (e) {
        toast(e.message, { error: true });
      }
      setUploading((u) => u.filter((x) => x !== tmp));
    }
    onChanged?.();
  };

  const removeAtt = async (a) => {
    try { await api.removeAttachment(a, draftId.current); setAttachments((x) => x.filter((y) => y.id !== a.id)); }
    catch (e) { toast(e.message, { error: true }); }
  };

  const close = async () => {
    closed.current = true;
    if (draftId.current || hasContent()) {
      const id = await save();
      if (id) toast('Draft saved');
    }
    onClose();
    onChanged?.();
  };

  const discard = async () => {
    closed.current = true;
    await chain.current;
    if (draftId.current) {
      try { await api.discardDraft(draftId.current, attachments); } catch (e) { toast(e.message, { error: true }); }
      toast('Draft discarded');
    }
    onClose();
    onChanged?.();
  };

  const validate = () => {
    if (!to.length && !cc.length && !bcc.length) { toast('Add at least one recipient', { error: true }); return false; }
    if (uploading.length) { toast('Please wait for attachments to finish uploading', { error: true }); return false; }
    if (!subject.trim() && !htmlToText(html).trim() && !window.confirm('Send this message without a subject or text?')) return false;
    return true;
  };

  const send = async (when) => {
    if (!validate()) return;
    closed.current = true;
    lastRecipients.current = null; // always re-save To/Cc/Bcc right before sending
    const id = await save();
    if (!id) { closed.current = false; return; }
    const reopen = { ...initial, draftId: id, to, cc, bcc, subject, html: sanitize(html), attachments, forwardAttachments: null };
    onClose();
    if (when) onSchedule(id, when, reopen);
    else onSend(id, reopen);
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  const onPaste = (e) => {
    const data = e.clipboardData;
    if (data.files?.length) { e.preventDefault(); addFiles(data.files); return; }
    const pasted = data.getData('text/html');
    if (pasted) {
      e.preventDefault();
      document.execCommand('insertHTML', false, sanitize(pasted));
      setHtml(editorRef.current.innerHTML);
    }
  };

  const allPicked = [...to, ...cc, ...bcc];
  const title = subject.trim() || (initial.threadId ? 'Reply' : 'New message');

  if (mode === 'min') {
    return (
      <div className="composer minimized" onClick={() => setMode('normal')}>
        <b>{title}</b>
        <div className="composer-head-tools" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Maximize2} label="Expand" onClick={() => setMode('normal')} size={15} />
          <IconButton icon={X} label="Save & close" onClick={close} size={16} />
        </div>
      </div>
    );
  }

  return (
    <>
      {mode === 'max' && <div className="scrim dim" onClick={() => setMode('normal')} />}
      <div
        className={`composer ${mode === 'max' ? 'maximized' : ''} ${dragOver ? 'drag' : ''}`}
        onKeyDown={onKeyDown}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        role="dialog"
        aria-label="Compose message"
      >
        <header className="composer-head" onDoubleClick={() => setMode(mode === 'max' ? 'normal' : 'max')}>
          <b>{title}</b>
          <div className="composer-head-tools">
            <IconButton icon={Minus} label="Minimise" onClick={() => setMode('min')} size={16} className="hide-sm" />
            <IconButton icon={mode === 'max' ? Minimize2 : Maximize2} label={mode === 'max' ? 'Exit full screen' : 'Full screen'} onClick={() => setMode(mode === 'max' ? 'normal' : 'max')} size={15} className="hide-sm" />
            <IconButton icon={X} label="Save & close (Esc)" onClick={close} size={17} />
          </div>
        </header>

        {initial.scheduledAt && (
          <div className="banner info">This message was scheduled for {friendlyFuture(initial.scheduledAt)}. Sending again will reschedule it.</div>
        )}

        <div className="composer-fields">
          <RecipientField
            label="To"
            ids={to}
            setIds={setTo}
            people={people}
            exclude={allPicked.filter((x) => !to.includes(x))}
            autoFocus={initial.focus !== 'body' && !to.length}
            extra={
              <span className="rcpt-toggles">
                {!showCc && <button type="button" className="text-btn" onClick={() => setShowCc(true)}>Cc</button>}
                {!showBcc && <button type="button" className="text-btn" onClick={() => setShowBcc(true)}>Bcc</button>}
              </span>
            }
          />
          {showCc && <RecipientField label="Cc" ids={cc} setIds={setCc} people={people} exclude={allPicked.filter((x) => !cc.includes(x))} autoFocus={!initial.cc?.length} />}
          {showBcc && (
            <RecipientField
              label="Bcc"
              ids={bcc}
              setIds={setBcc}
              people={people}
              exclude={allPicked.filter((x) => !bcc.includes(x))}
              autoFocus={!initial.bcc?.length}
              extra={<span className="rcpt-hint" title="Bcc recipients are hidden from everyone else">hidden</span>}
            />
          )}
          <input className="subject-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" maxLength={250} aria-label="Subject" />
        </div>

        <div
          ref={editorRef}
          className="editor"
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => { typed.current = true; setHtml(e.currentTarget.innerHTML); }}
          onFocus={(e) => {
            // First time into a new message: start typing above the signature / quote.
            if (typed.current || initial.draftId) return;
            typed.current = true;
            const el = e.currentTarget;
            requestAnimationFrame(() => {
              const sel = window.getSelection();
              const range = document.createRange();
              range.setStart(el, 0);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            });
          }}
          onPaste={onPaste}
          role="textbox"
          aria-multiline="true"
          aria-label="Message body"
          data-placeholder="Write your message…"
        />

        {(attachments.length > 0 || uploading.length > 0) && (
          <div className="composer-atts">
            {attachments.map((a) => (
              <span key={a.id} className="att-chip">
                <FileText size={14} /> <b>{a.file_name}</b> <small>{fileSize(a.size_bytes)}</small>
                <button type="button" onClick={() => removeAtt(a)} aria-label={`Remove ${a.file_name}`}><X size={13} /></button>
              </span>
            ))}
            {uploading.map((u) => (
              <span key={u.tmp} className="att-chip loading"><Loader2 size={14} className="spin" /> <b>{u.file_name}</b></span>
            ))}
          </div>
        )}

        <FormatBar editorRef={editorRef} onChange={() => setHtml(editorRef.current.innerHTML)} />

        <footer className="composer-foot">
          <div className="send-group relative">
            <button type="button" className="btn primary send-main" onClick={() => send()} title="Send (Ctrl+Enter)">Send</button>
            <button type="button" className="btn primary send-more" onClick={() => setSendMenu(true)} aria-label="More send options"><ChevronDown size={16} /></button>
            <Popover open={sendMenu} onClose={() => setSendMenu(false)} className="send-menu">
              <button type="button" className="menu-item" onClick={() => { setSendMenu(false); setSchedule(true); }}>
                <CalendarClock size={16} /><span>Schedule send</span>
              </button>
            </Popover>
            <TimePicker open={schedule} onClose={() => setSchedule(false)} title="Schedule send" onPick={(d) => send(d)} />
          </div>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <IconButton icon={Paperclip} label="Attach files (max 25 MB each)" onClick={() => fileRef.current?.click()} />
          <span className="save-status">{status}</span>
          <span className="toolbar-spacer" />
          <IconButton icon={Trash2} label="Discard draft" onClick={discard} />
        </footer>
        {dragOver && <div className="drop-hint"><Paperclip size={22} /> Drop files to attach</div>}
      </div>
    </>
  );
}
