import { useState } from 'react';
import {
  Inbox, Star, Clock, BookmarkCheck, Send, CalendarClock, File, Mails, Trash2,
  Plus, Pencil, MoreVertical, Tag, Shield,
} from 'lucide-react';
import { Popover, MenuItem, Modal, Field } from './ui.jsx';

export const FOLDERS = [
  { type: 'inbox', label: 'Inbox', icon: Inbox, count: 'inbox' },
  { type: 'starred', label: 'Starred', icon: Star },
  { type: 'snoozed', label: 'Snoozed', icon: Clock, count: 'snoozed', muted: true },
  { type: 'important', label: 'Important', icon: BookmarkCheck },
  { type: 'sent', label: 'Sent', icon: Send },
  { type: 'scheduled', label: 'Scheduled', icon: CalendarClock, count: 'scheduled', muted: true },
  { type: 'drafts', label: 'Drafts', icon: File, count: 'drafts', muted: true },
  { type: 'all', label: 'All Mail', icon: Mails },
  { type: 'trash', label: 'Trash', icon: Trash2 },
];

export const LABEL_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b'];

export function LabelDialog({ label, onSave, onClose }) {
  const [name, setName] = useState(label?.name || '');
  const [color, setColor] = useState(label?.color || LABEL_COLORS[5]);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onSave({ name: name.trim().slice(0, 50), color }); onClose(); } finally { setBusy(false); }
  };
  return (
    <Modal
      title={label ? 'Edit label' : 'New label'}
      onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>{label ? 'Save' : 'Create'}</button>
      </>}
    >
      <form onSubmit={save}>
        <Field label="Label name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={50} placeholder="e.g. Work" />
        </Field>
        <div className="field"><span>Colour</span>
          <div className="swatches">
            {LABEL_COLORS.map((c) => (
              <button type="button" key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function Sidebar({
  view, setView, counts, labels, onCompose, collapsed, mobileOpen, onCloseMobile,
  onCreateLabel, onEditLabel, onDeleteLabel, isAdmin,
}) {
  const [menuFor, setMenuFor] = useState(null);
  const [dialog, setDialog] = useState(null); // {label?}

  const go = (v) => { setView(v); onCloseMobile(); };
  const isActive = (v) => view.type === v.type && (v.type !== 'label' || view.id === v.id);

  return (
    <>
      {mobileOpen && <div className="scrim" onClick={onCloseMobile} />}
      <nav className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`} aria-label="Mail folders">
        <button className="compose-btn" onClick={() => { onCompose(); onCloseMobile(); }} title="Compose (c)">
          <Pencil size={20} /> <span>Compose</span>
        </button>

        <div className="nav-list">
          {FOLDERS.map((f) => {
            const n = f.count ? counts[f.count] : 0;
            return (
              <button key={f.type} className={`nav-item ${isActive(f) ? 'active' : ''}`} onClick={() => go({ type: f.type })} title={f.label}>
                <f.icon size={19} strokeWidth={isActive(f) ? 2.3 : 1.9} />
                <span className="nav-label">{f.label}</span>
                {n > 0 && <span className={`nav-count ${f.muted ? 'muted' : ''}`}>{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="nav-section">
          <span className="nav-label">Labels</span>
          <button className="icon-btn sm" onClick={() => setDialog({})} title="Create label" aria-label="Create label"><Plus size={16} /></button>
        </div>
        <div className="nav-list">
          {labels.length === 0 && !collapsed && <p className="nav-empty">Create labels to organise mail.</p>}
          {labels.map((l) => (
            <div key={l.id} className="nav-row">
              <button className={`nav-item ${isActive({ type: 'label', id: l.id }) ? 'active' : ''}`} onClick={() => go({ type: 'label', id: l.id })} title={l.name}>
                <Tag size={18} style={{ color: l.color }} fill={l.color} fillOpacity={0.25} />
                <span className="nav-label">{l.name}</span>
              </button>
              {!collapsed && (
                <div className="nav-more">
                  <button className="icon-btn sm" onClick={() => setMenuFor(menuFor === l.id ? null : l.id)} aria-label={`Options for ${l.name}`}><MoreVertical size={15} /></button>
                  <Popover open={menuFor === l.id} onClose={() => setMenuFor(null)} align="right">
                    <MenuItem icon={Pencil} onClick={() => { setMenuFor(null); setDialog({ label: l }); }}>Edit</MenuItem>
                    <MenuItem icon={Trash2} danger onClick={() => { setMenuFor(null); onDeleteLabel(l); }}>Delete label</MenuItem>
                  </Popover>
                </div>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <>
            <div className="nav-section"><span className="nav-label">Admin</span></div>
            <div className="nav-list">
              <button className={`nav-item ${view.type === 'admin' ? 'active' : ''}`} onClick={() => go({ type: 'admin' })} title="Manage users">
                <Shield size={19} /> <span className="nav-label">Manage users</span>
              </button>
            </div>
          </>
        )}
      </nav>

      {dialog && (
        <LabelDialog
          label={dialog.label}
          onClose={() => setDialog(null)}
          onSave={(v) => (dialog.label ? onEditLabel(dialog.label, v) : onCreateLabel(v))}
        />
      )}
    </>
  );
}
