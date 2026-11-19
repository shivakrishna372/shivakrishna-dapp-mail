import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, UserPlus, MoreVertical, KeyRound, ShieldCheck, ShieldOff, Ban, CheckCircle2, Pencil, Copy, RefreshCw, DatabaseBackup } from 'lucide-react';
import { Avatar, Field, IconButton, Modal, Popover, MenuItem, Spinner, useToast } from './ui.jsx';
import { adminApi, exportBackup } from '../lib/api.js';
import { DOMAIN, displayName, randomPassword, shortDate } from '../lib/utils.js';

function CredentialCard({ email, password }) {
  const toast = useToast();
  const text = `DAPP Mail login\nEmail: ${email}\nTemporary password: ${password}\nOn first sign-in you'll add a recovery email and choose your own password.`;
  return (
    <div className="cred-card">
      <div><small>Email</small><b>{email}</b></div>
      <div><small>Temporary password</small><b className="mono">{password}</b></div>
      <button className="btn outline sm" onClick={() => { navigator.clipboard?.writeText(text); toast('Login details copied'); }}>
        <Copy size={14} /> Copy login details
      </button>
      <p className="fine">Share this privately (in person or on WhatsApp). They’ll be asked to set their own password.</p>
    </div>
  );
}

export default function AdminPanel({ me, onBack, onUsersChanged }) {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [menu, setMenu] = useState(null);
  const [dialog, setDialog] = useState(null); // {type, user}
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    try { setUsers((await adminApi('list')).users); } catch (e) { toast(e.message, { error: true }); setUsers([]); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const open = (type, user = null) => {
    setMenu(null); setDone(null);
    setForm(type === 'create' ? { username: '', display_name: '', temp_password: randomPassword() }
      : type === 'reset' ? { temp_password: randomPassword() }
      : type === 'rename' ? { display_name: user.display_name } : {});
    setDialog({ type, user });
  };

  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); await load(); onUsersChanged?.(); } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };

  const submit = async (e) => {
    e?.preventDefault();
    const { type, user } = dialog;
    if (type === 'create') {
      await run(async () => {
        await adminApi('create', form);
        setDone({ email: `${form.username.toLowerCase()}@${DOMAIN}`, password: form.temp_password });
      }, 'User created');
    } else if (type === 'reset') {
      await run(async () => {
        await adminApi('reset_password', { user_id: user.id, temp_password: form.temp_password });
        setDone({ email: user.email, password: form.temp_password });
      }, 'Password reset');
    } else if (type === 'rename') {
      await run(() => adminApi('rename', { user_id: user.id, display_name: form.display_name }), 'Name updated');
      setDialog(null);
    }
  };

  const [backingUp, setBackingUp] = useState(false);
  const downloadBackup = async () => {
    setBackingUp(true);
    try {
      const data = await exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dapp-mail-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Backup downloaded — keep the file somewhere safe');
    } catch (e) {
      toast(e.message, { error: true });
    }
    setBackingUp(false);
  };

  const status = (u) => (u.disabled ? ['Disabled', 'bad'] : u.setup_complete ? ['Active', 'good'] : ['Setup pending', 'warn']);

  return (
    <section className="page-pane">
      <div className="toolbar">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h2 className="page-title">Manage users</h2>
        <span className="toolbar-spacer" />
        <IconButton icon={RefreshCw} label="Refresh" onClick={load} />
        <button className="btn primary sm" onClick={() => open('create')}><UserPlus size={16} /> Add user</button>
      </div>
      <div className="page-scroll">
        {!users ? <div className="center pad"><Spinner size={26} /></div> : (
          <div className="card table-card">
            <table className="user-table">
              <thead><tr><th>User</th><th>Status</th><th className="hide-sm">Recovery email</th><th className="hide-sm">Last sign-in</th><th /></tr></thead>
              <tbody>
                {users.map((u) => {
                  const [label, cls] = status(u);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="user-cell">
                          <Avatar person={u} size={36} />
                          <div><b>{displayName(u)} {u.is_admin && <span className="badge">Admin</span>} {u.id === me.id && <span className="badge soft">You</span>}</b><small>{u.email}</small></div>
                        </div>
                      </td>
                      <td><span className={`status ${cls}`}>{label}</span></td>
                      <td className="hide-sm muted">{u.recovery_email || '—'}</td>
                      <td className="hide-sm muted">{u.last_sign_in_at ? shortDate(u.last_sign_in_at) : 'Never'}</td>
                      <td className="relative">
                        <IconButton icon={MoreVertical} label="User actions" onClick={() => setMenu(menu === u.id ? null : u.id)} />
                        <Popover open={menu === u.id} onClose={() => setMenu(null)} align="right">
                          <MenuItem icon={Pencil} onClick={() => open('rename', u)}>Rename</MenuItem>
                          <MenuItem icon={KeyRound} onClick={() => open('reset', u)}>Reset password</MenuItem>
                          {u.id !== me.id && (
                            <>
                              <MenuItem icon={u.is_admin ? ShieldOff : ShieldCheck} onClick={() => { setMenu(null); run(() => adminApi('set_admin', { user_id: u.id, is_admin: !u.is_admin }), u.is_admin ? 'Admin role removed' : 'Made admin'); }}>
                                {u.is_admin ? 'Remove admin' : 'Make admin'}
                              </MenuItem>
                              <MenuItem icon={u.disabled ? CheckCircle2 : Ban} danger={!u.disabled} onClick={() => { setMenu(null); run(() => adminApi('set_disabled', { user_id: u.id, disabled: !u.disabled }), u.disabled ? 'Account enabled' : 'Account disabled'); }}>
                                {u.disabled ? 'Enable account' : 'Disable account'}
                              </MenuItem>
                            </>
                          )}
                        </Popover>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="fine pad">Disabled users can’t sign in, but their mail is kept. New users must add a recovery email and choose their own password on first sign-in.</p>

        <div className="card form-card backup-card">
          <div className="backup-head">
            <span className="backup-icon"><DatabaseBackup size={20} /></span>
            <div>
              <h3>Backup</h3>
              <p className="muted">Download all mail, users and labels as one file. Do this once a month and keep the file safe — it contains everyone’s mail. Attachment files are not included (only their names).</p>
            </div>
          </div>
          <div className="row-end">
            <button className="btn primary" onClick={downloadBackup} disabled={backingUp}>
              {backingUp ? <Spinner /> : <><DatabaseBackup size={16} /> Download backup</>}
            </button>
          </div>
        </div>
      </div>

      {dialog && (
        <Modal
          title={dialog.type === 'create' ? 'Add a user' : dialog.type === 'reset' ? `Reset password for ${displayName(dialog.user)}` : 'Rename user'}
          onClose={() => setDialog(null)}
          footer={done
            ? <button className="btn primary" onClick={() => setDialog(null)}>Done</button>
            : <>
                <button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button>
                <button className="btn primary" onClick={submit} disabled={busy}>{busy ? <Spinner /> : dialog.type === 'create' ? 'Create user' : dialog.type === 'reset' ? 'Reset password' : 'Save'}</button>
              </>}
        >
          {done ? <CredentialCard {...done} /> : (
            <form onSubmit={submit}>
              {dialog.type === 'create' && (
                <>
                  <Field label="Full name"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} autoFocus placeholder="Ravi Kumar" /></Field>
                  <Field label="Email address">
                    <div className="input-wrap plain">
                      <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} placeholder="ravi" required />
                      <span className="input-suffix">@{DOMAIN}</span>
                    </div>
                  </Field>
                </>
              )}
              {dialog.type === 'rename' && (
                <Field label="Display name"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} autoFocus /></Field>
              )}
              {(dialog.type === 'create' || dialog.type === 'reset') && (
                <Field label="Temporary password" hint="They’ll replace it with their own on next sign-in.">
                  <div className="input-wrap plain">
                    <input className="mono" value={form.temp_password} onChange={(e) => setForm({ ...form, temp_password: e.target.value })} minLength={8} required />
                    <button type="button" className="input-action" onClick={() => setForm({ ...form, temp_password: randomPassword() })} title="Generate new"><RefreshCw size={15} /></button>
                  </div>
                </Field>
              )}
            </form>
          )}
        </Modal>
      )}
    </section>
  );
}
