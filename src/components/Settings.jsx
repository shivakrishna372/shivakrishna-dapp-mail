import { useEffect, useState } from 'react';
import { ArrowLeft, User, ShieldCheck, Keyboard, Palette, CheckCircle2, Bell } from 'lucide-react';
import { NotificationSettings } from './Notifications.jsx';
import { Avatar, Field, IconButton, Spinner, useToast } from './ui.jsx';
import { PasswordStrength } from './AuthScreens.jsx';
import * as api from '../lib/api.js';

export const SHORTCUTS = [
  ['c', 'Compose'],
  ['/', 'Search mail'],
  ['r', 'Reply'],
  ['a', 'Reply all'],
  ['f', 'Forward'],
  ['e', 'Archive'],
  ['#', 'Delete'],
  ['s', 'Star / unstar'],
  ['u', 'Back to list'],
  ['Shift + u', 'Mark as unread'],
  ['g then i', 'Go to Inbox'],
  ['g then s', 'Go to Starred'],
  ['g then t', 'Go to Sent'],
  ['g then d', 'Go to Drafts'],
  ['Ctrl + Enter', 'Send (in compose)'],
  ['Esc', 'Close compose / clear search'],
  ['?', 'Show shortcuts'],
];

export function ShortcutList() {
  return (
    <div className="shortcut-grid">
      {SHORTCUTS.map(([k, d]) => (
        <div key={k} className="shortcut"><kbd>{k}</kbd><span>{d}</span></div>
      ))}
    </div>
  );
}

export default function Settings({ me, security, onBack, onProfileSaved, theme, setTheme, density, setDensity, undoSecs = 3, setUndoSecs, undoChoices = [0, 3, 5, 10], initialTab = 'general' }) {
  const toast = useToast();
  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState(me.display_name || '');
  const [signature, setSignature] = useState(me.signature || '');
  const [busy, setBusy] = useState(false);

  // password
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  // recovery email
  const [recStep, setRecStep] = useState('view');
  const [recEmail, setRecEmail] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(security?.recovery_email || '');

  useEffect(() => { setName(me.display_name || ''); setSignature(me.signature || ''); }, [me]);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };

  const saveProfile = (e) => {
    e.preventDefault();
    run(async () => {
      await api.updateMyProfile(me.id, { display_name: name.trim().slice(0, 80) || me.username, signature: signature.slice(0, 2000) });
      onProfileSaved();
      toast('Settings saved');
    });
  };

  const changePassword = (e) => {
    e.preventDefault();
    run(async () => {
      if (next !== confirm) throw new Error('New passwords don’t match');
      if (next.length < 8) throw new Error('Use at least 8 characters');
      await api.auth.verifyCurrentPassword(me.email, current);
      await api.auth.setNewPassword(next);
      setCurrent(''); setNext(''); setConfirm('');
      toast('Password changed');
    });
  };

  const tabs = [
    ['general', 'General', User],
    ['notifications', 'Notifications', Bell],
    ['appearance', 'Appearance', Palette],
    ['security', 'Security', ShieldCheck],
    ['shortcuts', 'Shortcuts', Keyboard],
  ];

  return (
    <section className="page-pane">
      <div className="toolbar">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h2 className="page-title">Settings</h2>
      </div>
      <div className="page-scroll">
        <div className="tabs" role="tablist">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <>
          <form className="card form-card" onSubmit={saveProfile}>
            <div className="profile-head">
              <Avatar person={{ ...me, display_name: name }} size={64} />
              <div><b>{name || me.username}</b><small>{me.email}</small></div>
            </div>
            <Field label="Display name" hint="This is the name people see on your messages.">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Signature" hint="Added to the end of new messages and replies.">
              <textarea className="input" rows={4} value={signature} onChange={(e) => setSignature(e.target.value)} maxLength={2000} placeholder={'e.g.\nShiva Krishna\nDAPP Team'} />
            </Field>
            <div className="row-end"><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : 'Save changes'}</button></div>
          </form>
          <div className="card form-card">
            <div className="field"><span>Undo send</span>
              <div className="seg">
                {undoChoices.map((n) => (
                  <button key={n} type="button" className={undoSecs === n ? 'on' : ''} onClick={() => setUndoSecs?.(n)}>{n ? `${n} sec` : 'Off'}</button>
                ))}
              </div>
              <small className="muted">How long you get to press “Undo” after sending. Off sends instantly.</small>
            </div>
          </div>
          </>
        )}

        {tab === 'appearance' && (
          <div className="card form-card">
            <div className="field"><span>Theme</span>
              <div className="seg">
                {['light', 'dark', 'system'].map((t) => (
                  <button key={t} type="button" className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
            </div>
            <div className="field"><span>Density</span>
              <div className="seg">
                {['comfortable', 'compact'].map((d) => (
                  <button key={d} type="button" className={density === d ? 'on' : ''} onClick={() => setDensity(d)}>{d[0].toUpperCase() + d.slice(1)}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'security' && (
          <>
            <form className="card form-card" onSubmit={changePassword}>
              <h3>Change password</h3>
              <Field label="Current password"><input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field>
              <Field label="New password"><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
              <PasswordStrength value={next} />
              <Field label="Confirm new password"><input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></Field>
              <div className="row-end"><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : 'Update password'}</button></div>
            </form>

            <div className="card form-card">
              <h3>Recovery email</h3>
              <p className="muted">Password reset links are sent only to this verified address.</p>
              {recStep === 'view' && (
                <div className="rec-row">
                  <CheckCircle2 size={18} className="ok" /> <b>{recovery || 'Not set'}</b>
                  <span className="toolbar-spacer" />
                  <button className="btn ghost sm" onClick={() => setRecStep('email')}>Change</button>
                </div>
              )}
              {recStep === 'email' && (
                <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.auth.sendRecoveryCode(recEmail.trim().toLowerCase()); setRecStep('code'); toast('Code sent — check that inbox'); }); }}>
                  <Field label="New recovery email"><input className="input" type="email" value={recEmail} onChange={(e) => setRecEmail(e.target.value)} required autoFocus placeholder="you@gmail.com" /></Field>
                  <div className="row-end">
                    <button type="button" className="btn ghost" onClick={() => setRecStep('view')}>Cancel</button>
                    <button className="btn primary" disabled={busy}>Send code</button>
                  </div>
                </form>
              )}
              {recStep === 'code' && (
                <form onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api.auth.verifyRecoveryCode(code); setRecovery(r?.recovery_email || recEmail); setRecStep('view'); setCode(''); toast('Recovery email updated'); }); }}>
                  <Field label="6-digit code"><input className="input code-sm" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus /></Field>
                  <div className="row-end">
                    <button type="button" className="btn ghost" onClick={() => setRecStep('view')}>Cancel</button>
                    <button className="btn primary" disabled={busy}>Verify</button>
                  </div>
                </form>
              )}
            </div>
          </>
        )}

        {tab === 'notifications' && <NotificationSettings />}

        {tab === 'shortcuts' && <div className="card form-card"><ShortcutList /></div>}
      </div>
    </section>
  );
}
