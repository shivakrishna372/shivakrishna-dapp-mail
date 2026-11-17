import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import './App.css';

const folders = [
  ['inbox', '📥', 'Inbox'],
  ['starred', '⭐', 'Starred'],
  ['important', '❗', 'Important'],
  ['sent', '📤', 'Sent'],
  ['drafts', '📝', 'Drafts'],
  ['archive', '📦', 'Archive'],
  ['trash', '🗑️', 'Trash'],
];

const blankCompose = {
  id: null,
  threadId: null,
  inReplyTo: null,
  to: [],
  cc: [],
  bcc: [],
  subject: '',
  body: '',
};

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [security, setSecurity] = useState(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [setupMessage, setSetupMessage] = useState('');
  const [setupStep, setSetupStep] = useState('recovery');
  const [folder, setFolder] = useState('inbox');
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState([]);
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState(blankCompose);
  const [composeError, setComposeError] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data?.session ?? null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, next) => {
        if (!mounted) return;
        setSession(next);
        if (event === 'PASSWORD_RECOVERY') {
          setAuthMode('new-password');
          setAuthMessage('Enter a new password for your account.');
          setAuthError('');
        }
      }
    );
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setAuthError('');
    setAuthMessage('');
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) setAuthError(error.message);
    setBusy(false);
  }

  async function sendReset(e) {
    e.preventDefault();
    setBusy(true);
    setAuthError('');
    setAuthMessage('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) setAuthError(error.message);
    else
      setAuthMessage(
        'Password reset email sent. Check your inbox and Spam folder.'
      );
    setBusy(false);
  }

  async function updatePassword(e) {
    e.preventDefault();
    setBusy(true);
    setAuthError('');
    setAuthMessage('');
    if (newPassword.length < 8) {
      setAuthError('Password must contain at least 8 characters.');
      setBusy(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setAuthError(error.message);
    else {
      setAuthMessage(
        'Password updated successfully. Please sign in with your new password.'
      );
      setNewPassword('');
      await supabase.auth.signOut();
      setSession(null);
      setAuthMode('login');
    }
    setBusy(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    setSelected(null);
    setThread([]);
    setItems([]);
    setSecurity(null);
    setSecurityError('');
    setSecurityLoading(false);
  }

  useEffect(() => {
    let active = true;
    async function loadSecurity() {
      if (!session?.user?.id) {
        setSecurity(null);
        return;
      }
      setSecurityLoading(true);
      setSecurityError('');
      const { data, error } = await supabase
        .from('user_security')
        .select(
          'user_id,recovery_email,recovery_email_verified,first_login_completed'
        )
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setSecurityError(error.message);
        setSecurity(null);
      } else if (!data) {
        setSecurityError(
          'Your security profile is missing. Contact the DAPP Mail administrator.'
        );
        setSecurity(null);
      } else {
        setSecurity(data);
        setRecoveryEmail(data.recovery_email || '');
        setSetupStep(data.recovery_email_verified ? 'password' : 'recovery');
      }
      setSecurityLoading(false);
    }
    loadSecurity();
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  async function sendRecoveryCode(e) {
    e.preventDefault();
    setBusy(true);
    setSecurityError('');
    setSetupMessage('');
    const address = recoveryEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setSecurityError('Enter a valid recovery email address.');
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.functions.invoke('recovery-email', {
      body: { action: 'send', recovery_email: address },
    });
    if (error || data?.error) {
      setSecurityError(
        data?.error || error?.message || 'Could not send verification code.'
      );
    } else {
      setSetupStep('verify');
      setSetupMessage(
        'Verification code sent. Check your inbox and Spam folder.'
      );
    }
    setBusy(false);
  }

  async function verifyRecoveryCode(e) {
    e.preventDefault();
    setBusy(true);
    setSecurityError('');
    setSetupMessage('');
    const { data, error } = await supabase.functions.invoke('recovery-email', {
      body: { action: 'verify', code: verificationCode.trim() },
    });
    if (error || data?.error || data?.success !== true) {
      setSecurityError(
        data?.error ||
          error?.message ||
          'Verification failed. Check the code and try again.'
      );
    } else {
      setSecurity((old) =>
        old
          ? {
              ...old,
              recovery_email: recoveryEmail.trim().toLowerCase(),
              recovery_email_verified: true,
            }
          : old
      );
      setSetupStep('password');
      setVerificationCode('');
      setSetupMessage(
        'Recovery email verified. Now create your personal password.'
      );
    }
    setBusy(false);
  }

  async function completeFirstLogin(e) {
    e.preventDefault();
    setBusy(true);
    setSecurityError('');
    setSetupMessage('');

    if (newPassword.length < 8) {
      setSecurityError('Password must contain at least 8 characters.');
      setBusy(false);
      return;
    }

    if (!security?.recovery_email_verified) {
      setSecurityError(
        'Verify your recovery email before setting your password.'
      );
      setBusy(false);
      return;
    }

    // Update the user's password
    const { error: passwordError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (passwordError) {
      setSecurityError(passwordError.message);
      setBusy(false);
      return;
    }

    // Activate account securely through Edge Function
    const { data: activation, error: activationError } =
      await supabase.functions.invoke('recovery-email', {
        body: { action: 'activate' },
      });

    if (activationError || activation?.success !== true) {
      setSecurityError(
        activation?.error ||
          activationError?.message ||
          'Account activation failed.'
      );
      setBusy(false);
      return;
    }

    setSecurity((old) => ({
      ...old,
      first_login_completed: true,
    }));

    setNewPassword('');
    setSetupMessage('First-login security setup completed.');
    setBusy(false);
  }

  async function loadProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,display_name')
      .order('email');
    if (error) throw error;
    setProfiles(data || []);
  }

  async function loadMailbox() {
    if (!session?.user?.id) return;
    let q = supabase
      .from('mailbox')
      .select(
        `
      id,user_id,folder,is_read,is_starred,is_important,created_at,
      message:messages!mailbox_message_id_fkey(
        id,thread_id,in_reply_to,sender_id,subject,body_text,body_html,sent_at,created_at,
        sender:profiles!messages_sender_id_fkey(id,email,display_name)
      )
    `
      )
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (folder === 'starred')
      q = q.eq('is_starred', true).neq('folder', 'trash');
    else if (folder === 'important')
      q = q.eq('is_important', true).neq('folder', 'trash');
    else q = q.eq('folder', folder);

    const { data, error } = await q;
    if (error) setComposeError(error.message);
    else setItems((data || []).filter((x) => x.message));
  }

  useEffect(() => {
    if (!session || !security?.first_login_completed) return;
    loadProfiles().catch((e) => setComposeError(e.message));
  }, [session, security?.first_login_completed]);

  useEffect(() => {
    if (session && security?.first_login_completed) loadMailbox();
  }, [session, folder, security?.first_login_completed]);

  async function openMessage(item) {
    setSelected(item);
    if (!item.is_read && item.folder === 'inbox') {
      await supabase
        .from('mailbox')
        .update({ is_read: true })
        .eq('id', item.id);
      setItems((old) =>
        old.map((x) => (x.id === item.id ? { ...x, is_read: true } : x))
      );
    }
    const msg = item.message;
    let q = supabase
      .from('messages')
      .select(
        `
      id,thread_id,in_reply_to,sender_id,subject,body_text,sent_at,created_at,
      sender:profiles!messages_sender_id_fkey(id,email,display_name)
    `
      )
      .order('created_at', { ascending: true });
    q = msg.thread_id ? q.eq('thread_id', msg.thread_id) : q.eq('id', msg.id);
    const { data, error } = await q;
    if (error) setComposeError(error.message);
    else setThread(data || [msg]);
  }

  async function flag(item, field) {
    const value = !item[field];
    const { error } = await supabase
      .from('mailbox')
      .update({ [field]: value })
      .eq('id', item.id);
    if (error) setComposeError(error.message);
    else {
      setItems((old) =>
        old.map((x) => (x.id === item.id ? { ...x, [field]: value } : x))
      );
      if (selected?.id === item.id)
        setSelected({ ...selected, [field]: value });
    }
  }

  async function move(item, target) {
    const { error } = await supabase
      .from('mailbox')
      .update({ folder: target })
      .eq('id', item.id);
    if (error) setComposeError(error.message);
    else {
      setSelected(null);
      setThread([]);
      await loadMailbox();
    }
  }

  async function saveDraft() {
    const payload = {
      sender_id: session.user.id,
      thread_id: compose.threadId,
      in_reply_to: compose.inReplyTo,
      subject: compose.subject.trim(),
      body_text: compose.body,
      body_html: compose.body.replace(/\n/g, '<br>'),
      sent_at: null,
    };
    let id = compose.id;
    if (id) {
      const { error } = await supabase
        .from('messages')
        .update(payload)
        .eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('messages')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      id = data.id;
    }
    const { error: deleteError } = await supabase
      .from('message_recipients')
      .delete()
      .eq('message_id', id);
    if (deleteError) throw deleteError;
    const recipients = [
      ...compose.to.map((user_id) => ({ message_id: id, user_id, kind: 'to' })),
      ...compose.cc.map((user_id) => ({ message_id: id, user_id, kind: 'cc' })),
      ...compose.bcc.map((user_id) => ({
        message_id: id,
        user_id,
        kind: 'bcc',
      })),
    ];
    if (recipients.length) {
      const { error } = await supabase
        .from('message_recipients')
        .insert(recipients);
      if (error) throw error;
    }
    return id;
  }

  async function saveOnly() {
    setBusy(true);
    setComposeError('');
    try {
      await saveDraft();
      setComposeError('Draft saved.');
      await loadMailbox();
    } catch (e) {
      setComposeError(e.message);
    }
    setBusy(false);
  }

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setComposeError('');
    if (![...compose.to, ...compose.cc, ...compose.bcc].length) {
      setComposeError('Select at least one recipient.');
      setBusy(false);
      return;
    }
    try {
      const id = await saveDraft();
      const { error } = await supabase.rpc('send_message', {
        p_message_id: id,
      });
      if (error) throw error;
      setComposeOpen(false);
      setCompose(blankCompose);
      setFolder('sent');
      await loadMailbox();
    } catch (err) {
      setComposeError(err.message);
    }
    setBusy(false);
  }

  async function openDraft(item) {
    const { data, error } = await supabase
      .from('message_recipients')
      .select('user_id,kind')
      .eq('message_id', item.message.id);
    if (error) {
      setComposeError(error.message);
      return;
    }
    setCompose({
      id: item.message.id,
      threadId: item.message.thread_id || null,
      inReplyTo: item.message.in_reply_to || null,
      to: (data || []).filter((x) => x.kind === 'to').map((x) => x.user_id),
      cc: (data || []).filter((x) => x.kind === 'cc').map((x) => x.user_id),
      bcc: (data || []).filter((x) => x.kind === 'bcc').map((x) => x.user_id),
      subject: item.message.subject || '',
      body: item.message.body_text || '',
    });
    setComposeOpen(true);
    setSelected(null);
  }

  function toggleRecipient(kind, id) {
    setCompose((old) => ({
      ...old,
      [kind]: old[kind].includes(id)
        ? old[kind].filter((x) => x !== id)
        : [...old[kind], id],
    }));
  }

  async function reply(mode) {
    if (!selected) return;
    const last = thread[thread.length - 1] || selected.message;
    const to = last.sender_id !== session.user.id ? [last.sender_id] : [];
    let cc = [];
    if (mode === 'all') {
      const { data } = await supabase
        .from('message_recipients')
        .select('user_id,kind')
        .eq('message_id', last.id)
        .in('kind', ['to', 'cc']);
      cc = (data || [])
        .filter(
          (x) => x.user_id !== session.user.id && x.user_id !== last.sender_id
        )
        .map((x) => x.user_id);
    }
    setCompose({
      ...blankCompose,
      threadId: last.thread_id || selected.message.thread_id || null,
      inReplyTo: last.id,
      to,
      cc,
      subject: /^re:/i.test(last.subject || '')
        ? last.subject
        : `Re: ${last.subject || ''}`,
      body: `\n\nOn ${new Date(
        last.sent_at || last.created_at
      ).toLocaleString()}, ${last.sender?.email || 'sender'} wrote:\n> ${(
        last.body_text || ''
      )
        .split('\n')
        .join('\n> ')}`,
    });
    setShowCc(mode === 'all');
    setComposeOpen(true);
  }

  function forward() {
    if (!selected) return;
    const last = thread[thread.length - 1] || selected.message;
    setCompose({
      ...blankCompose,
      subject: /^fwd:/i.test(last.subject || '')
        ? last.subject
        : `Fwd: ${last.subject || ''}`,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${
        last.sender?.email || ''
      }\nSubject: ${last.subject || ''}\n\n${last.body_text || ''}`,
    });
    setComposeOpen(true);
  }

  const filtered = items.filter((item) => {
    const m = item.message || {};
    const s = m.sender || {};
    const term = search.toLowerCase();
    return (
      !term ||
      [m.subject, m.body_text, s.email, s.display_name].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(term)
      )
    );
  });
  const unread = items.filter((x) => !x.is_read).length;

  if (authLoading)
    return <div className="loading-screen">Opening DAPP Mail…</div>;

  if (session && (securityLoading || (!security && !securityError)))
    return <div className="loading-screen">Checking account security…</div>;

  if (session && security && !security.first_login_completed) {
    return (
      <main className="auth-page">
        <form
          className="auth-card"
          onSubmit={
            setupStep === 'recovery'
              ? sendRecoveryCode
              : setupStep === 'verify'
              ? verifyRecoveryCode
              : completeFirstLogin
          }
        >
          <div className="auth-brand">✉ DAPP Mail</div>
          <span className="auth-kicker">FIRST-LOGIN SECURITY SETUP</span>
          <h1>
            {setupStep === 'recovery'
              ? 'Add recovery email'
              : setupStep === 'verify'
              ? 'Verify your email'
              : 'Create your password'}
          </h1>
          <p>
            {setupStep === 'recovery'
              ? 'Add an email address you can access. We will send a one-time verification code.'
              : setupStep === 'verify'
              ? `Enter the 6-digit code sent to ${recoveryEmail}.`
              : 'Your recovery email is verified. Set a new password to activate your mailbox.'}
          </p>
          {setupStep === 'recovery' && (
            <>
              <label>Recovery email</label>
              <input
                type="email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </>
          )}
          {setupStep === 'verify' && (
            <>
              <label>6-digit verification code</label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength="6"
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(
                    e.target.value.replace(/\D/g, '').slice(0, 6)
                  )
                }
                placeholder="Enter code"
                required
              />
              <button
                type="button"
                className="link-button forgot"
                onClick={() => {
                  setSetupStep('recovery');
                  setSetupMessage('');
                  setSecurityError('');
                }}
              >
                Change recovery email
              </button>
            </>
          )}
          {setupStep === 'password' && (
            <>
              <label>New password</label>
              <input
                type="password"
                minLength="8"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </>
          )}
          {securityError && <div className="alert error">{securityError}</div>}
          {setupMessage && <div className="alert success">{setupMessage}</div>}
          <button className="primary full" disabled={busy}>
            {busy
              ? 'Please wait…'
              : setupStep === 'recovery'
              ? 'Send verification code'
              : setupStep === 'verify'
              ? 'Verify code'
              : 'Activate DAPP Mail'}
          </button>
          <button type="button" className="link-button back" onClick={logout}>
            Sign out
          </button>
          <small>Signed in as {session.user.email}</small>
        </form>
      </main>
    );
  }

  if (session && securityError && !security) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-brand">✉ DAPP Mail</div>
          <h1>Account security check failed</h1>
          <div className="alert error">{securityError}</div>
          <button
            className="primary full"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
          <button className="link-button back" onClick={logout}>
            Sign out
          </button>
        </section>
      </main>
    );
  }

  if (!session || authMode === 'forgot' || authMode === 'new-password') {
    const isForgot = authMode === 'forgot';
    const isNew = authMode === 'new-password';
    return (
      <main className="auth-page">
        <form
          className="auth-card"
          onSubmit={isForgot ? sendReset : isNew ? updatePassword : login}
        >
          <div className="auth-brand">✉ DAPP Mail</div>
          <span className="auth-kicker">TEAM COMMUNICATION</span>
          <h1>
            {isForgot
              ? 'Reset your password'
              : isNew
              ? 'Choose a new password'
              : 'Welcome back'}
          </h1>
          <p>
            {isForgot
              ? 'Enter your registered email. We’ll send you a secure reset link.'
              : isNew
              ? 'Enter a new password for your account.'
              : 'Sign in to access your team mailbox.'}
          </p>
          {!isNew && (
            <>
              <label>Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
              />
            </>
          )}
          {isNew ? (
            <>
              <label>New password</label>
              <input
                type="password"
                minLength="8"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </>
          ) : (
            !isForgot && (
              <>
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                />
                <button
                  className="link-button forgot"
                  type="button"
                  onClick={() => {
                    setAuthMode('forgot');
                    setAuthError('');
                    setAuthMessage('');
                  }}
                >
                  Forgot password?
                </button>
              </>
            )
          )}
          {authError && <div className="alert error">{authError}</div>}
          {authMessage && <div className="alert success">{authMessage}</div>}
          <button className="primary full" disabled={busy}>
            {busy
              ? 'Please wait…'
              : isForgot
              ? 'Send reset link'
              : isNew
              ? 'Update password'
              : 'Sign in'}
          </button>
          {(isForgot || isNew) && (
            <button
              type="button"
              className="link-button back"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
                setAuthMessage('');
              }}
            >
              ← Back to sign in
            </button>
          )}
          <small>Secure team mailbox · DAPP Mail</small>
        </form>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          ✉ <b>DAPP Mail</b>
        </div>
        <input
          className="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search mail"
        />
        <div className="account">
          <span>{session.user.email}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <button
            className="compose-btn"
            onClick={() => {
              setCompose(blankCompose);
              setComposeError('');
              setComposeOpen(true);
            }}
          >
            ＋ Compose
          </button>
          {folders.map(([id, icon, label]) => (
            <button
              key={id}
              className={`folder ${folder === id ? 'active' : ''}`}
              onClick={() => {
                setFolder(id);
                setSelected(null);
                setThread([]);
              }}
            >
              <span>{icon}</span>
              {label}
              {id === 'inbox' && unread > 0 && <b>{unread}</b>}
            </button>
          ))}
        </aside>
        <main className="main">
          <div className="heading">
            <div>
              <small>YOUR WORKSPACE</small>
              <h1>{folders.find((x) => x[0] === folder)?.[2]}</h1>
              <p>{filtered.length} messages</p>
            </div>
            <button className="outline" onClick={loadMailbox}>
              ↻ Refresh
            </button>
          </div>
          {composeError && !composeOpen && (
            <div className="alert error">{composeError}</div>
          )}
          <div className={`content ${selected ? 'reading' : ''}`}>
            <section className="list">
              {filtered.length === 0 ? (
                <div className="empty">
                  <div>✉</div>
                  <b>Nothing here yet</b>
                  <span>Messages will appear here.</span>
                </div>
              ) : (
                filtered.map((item) => (
                  <article
                    key={item.id}
                    className={`mail-row ${
                      !item.is_read && item.folder !== 'drafts' ? 'unread' : ''
                    } ${selected?.id === item.id ? 'chosen' : ''}`}
                    onClick={() =>
                      item.folder === 'drafts'
                        ? openDraft(item)
                        : openMessage(item)
                    }
                  >
                    <button
                      className={`star ${item.is_starred ? 'on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        flag(item, 'is_starred');
                      }}
                    >
                      ★
                    </button>
                    <div className="row-copy">
                      <div className="row-top">
                        <b>
                          {item.folder === 'drafts'
                            ? 'Draft'
                            : item.message.sender?.display_name ||
                              item.message.sender?.email ||
                              'Sender'}
                        </b>
                        <time>
                          {new Date(
                            item.message.sent_at || item.message.created_at
                          ).toLocaleDateString()}
                        </time>
                      </div>
                      <strong>{item.message.subject || '(No subject)'}</strong>
                      <span>
                        {(item.message.body_text || '')
                          .replace(/\s+/g, ' ')
                          .slice(0, 130)}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </section>
            {selected && (
              <section className="reader">
                <div className="reader-tools">
                  <button
                    onClick={() => {
                      setSelected(null);
                      setThread([]);
                    }}
                  >
                    ← Back
                  </button>
                  <button onClick={() => flag(selected, 'is_important')}>
                    ❗
                  </button>
                  <button onClick={() => move(selected, 'archive')}>
                    Archive
                  </button>
                  <button onClick={() => move(selected, 'trash')}>Trash</button>
                </div>
                <h2>{selected.message.subject || '(No subject)'}</h2>
                {thread.map((m) => (
                  <article className="thread" key={m.id}>
                    <b>{m.sender?.display_name || m.sender?.email}</b>
                    <small>
                      {m.sender?.email} ·{' '}
                      {new Date(m.sent_at || m.created_at).toLocaleString()}
                    </small>
                    <p>{m.body_text}</p>
                  </article>
                ))}
                <div className="reply-buttons">
                  <button className="outline" onClick={() => reply('one')}>
                    Reply
                  </button>
                  <button className="outline" onClick={() => reply('all')}>
                    Reply all
                  </button>
                  <button className="outline" onClick={forward}>
                    Forward
                  </button>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      {composeOpen && (
        <div className="modal-bg">
          <form className="compose" onSubmit={send}>
            <header>
              <b>{compose.id ? 'Draft message' : 'New message'}</b>
              <button type="button" onClick={() => setComposeOpen(false)}>
                ×
              </button>
            </header>
            <div className="compose-body">
              <div className="recipient-label">
                <b>To</b>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowCc(!showCc)}
                >
                  Cc
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowBcc(!showBcc)}
                >
                  Bcc
                </button>
              </div>
              <div className="recipient-grid">
                {profiles
                  .filter((p) => p.id !== session.user.id)
                  .map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={compose.to.includes(p.id)}
                        onChange={() => toggleRecipient('to', p.id)}
                      />
                      {p.display_name || p.email}
                    </label>
                  ))}
              </div>
              {(showCc || compose.cc.length > 0) && (
                <div className="recipient-extra">
                  <b>Cc</b>
                  {profiles
                    .filter((p) => p.id !== session.user.id)
                    .map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={compose.cc.includes(p.id)}
                          onChange={() => toggleRecipient('cc', p.id)}
                        />
                        {p.email}
                      </label>
                    ))}
                </div>
              )}
              {(showBcc || compose.bcc.length > 0) && (
                <div className="recipient-extra">
                  <b>Bcc</b>
                  {profiles
                    .filter((p) => p.id !== session.user.id)
                    .map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={compose.bcc.includes(p.id)}
                          onChange={() => toggleRecipient('bcc', p.id)}
                        />
                        {p.email}
                      </label>
                    ))}
                </div>
              )}
              <input
                className="subject"
                value={compose.subject}
                onChange={(e) =>
                  setCompose({ ...compose, subject: e.target.value })
                }
                placeholder="Subject"
              />
              <textarea
                value={compose.body}
                onChange={(e) =>
                  setCompose({ ...compose, body: e.target.value })
                }
                placeholder="Write your message…"
              />
            </div>
            {composeError && (
              <div className="compose-error">{composeError}</div>
            )}
            <footer>
              <button className="primary" disabled={busy}>
                {busy ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                className="outline"
                disabled={busy}
                onClick={saveOnly}
              >
                Save draft
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => setComposeOpen(false)}
              >
                Close
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
