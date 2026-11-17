import { useState } from 'react';
import { Mail, Lock, ShieldCheck, KeyRound, ArrowLeft, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { auth } from '../lib/api.js';
import { DOMAIN } from '../lib/utils.js';
import { Spinner } from './ui.jsx';

function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <aside className="auth-hero">
        <div className="brand-lg"><span className="brand-mark"><Mail size={22} /></span> DAPP Mail</div>
        <div className="auth-hero-copy">
          <h2>Private mail for your team.</h2>
          <p>Fast, secure and built only for the people you invite.</p>
          <ul>
            <li><ShieldCheck size={18} /> Protected by database-level security rules</li>
            <li><Lock size={18} /> Bcc stays truly private</li>
            <li><KeyRound size={18} /> Personal recovery email for every account</li>
          </ul>
        </div>
        <small>© {new Date().getFullYear()} DAPP</small>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <Lock size={16} className="input-icon" />
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        minLength={autoComplete === 'new-password' ? 8 : undefined}
        maxLength={72}
      />
      <button type="button" className="input-action" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function AddressInput({ value, onChange, autoFocus }) {
  return (
    <div className="input-wrap">
      <Mail size={16} className="input-icon" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.trim().toLowerCase())}
        placeholder="yourname"
        autoComplete="username"
        autoFocus={autoFocus}
        required
        spellCheck={false}
      />
      {!value.includes('@') && <span className="input-suffix">@{DOMAIN}</span>}
    </div>
  );
}

const fullAddress = (v) => (v.includes('@') ? v : `${v}@${DOMAIN}`);

export function PasswordStrength({ value }) {
  const score = [/.{8,}/, /[A-Z]/, /[a-z]/, /\d/, /[^\w]/, /.{12,}/].filter((r) => r.test(value)).length;
  const level = score <= 2 ? 'weak' : score <= 4 ? 'okay' : 'strong';
  if (!value) return null;
  return (
    <div className={`strength ${level}`}>
      <div><i style={{ width: `${(score / 6) * 100}%` }} /></div>
      <small>{level === 'weak' ? 'Weak — add numbers, capitals or symbols' : level === 'okay' ? 'Good' : 'Strong password'}</small>
    </div>
  );
}

// ---------------- Login + forgot password ----------------
export function LoginScreen() {
  const [mode, setMode] = useState('login');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'login') await auth.signIn(fullAddress(address), password);
      else {
        const r = await auth.requestReset(fullAddress(address));
        setMessage(r?.message || 'If this account has a verified recovery email, a reset link has been sent to it.');
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  const forgot = mode === 'forgot';
  return (
    <AuthLayout>
      <form onSubmit={submit} className="auth-form">
        {forgot && (
          <button type="button" className="text-btn back-link" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>
            <ArrowLeft size={16} /> Back to sign in
          </button>
        )}
        <h1>{forgot ? 'Reset your password' : 'Welcome back'}</h1>
        <p className="muted">
          {forgot
            ? 'We’ll send a reset link to the personal recovery email you verified on your first login.'
            : 'Sign in to your DAPP Mail account.'}
        </p>
        <label className="label">Email address</label>
        <AddressInput value={address} onChange={setAddress} autoFocus />
        {!forgot && (
          <>
            <div className="label-row">
              <label className="label">Password</label>
              <button type="button" className="text-btn" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button>
            </div>
            <PasswordInput value={password} onChange={setPassword} placeholder="Your password" autoComplete="current-password" />
          </>
        )}
        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success"><CheckCircle2 size={16} /> {message}</div>}
        <button className="btn primary block" disabled={busy}>
          {busy ? <Spinner /> : forgot ? 'Send reset link' : 'Sign in'}
        </button>
        {forgot && (
          <p className="fine">No recovery email set up? Ask your DAPP Mail admin to reset your password.</p>
        )}
      </form>
    </AuthLayout>
  );
}

// ---------------- Arrived from a reset link ----------------
export function NewPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords don’t match');
    setBusy(true); setError('');
    try {
      await auth.setNewPassword(password);
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="auth-form">
        <h1>Choose a new password</h1>
        <p className="muted">Use at least 8 characters. Don’t reuse a password from another site.</p>
        <label className="label">New password</label>
        <PasswordInput value={password} onChange={setPassword} placeholder="New password" autoComplete="new-password" autoFocus />
        <PasswordStrength value={password} />
        <label className="label">Confirm password</label>
        <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat password" autoComplete="new-password" />
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? <Spinner /> : 'Save password'}</button>
      </form>
    </AuthLayout>
  );
}

// ---------------- First login: recovery email + personal password ----------------
export function SetupScreen({ user, security, onComplete }) {
  const [step, setStep] = useState(security?.recovery_email_verified ? 'password' : 'email');
  const [recovery, setRecovery] = useState(security?.recovery_email || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function run(fn) {
    setBusy(true); setError(''); setInfo('');
    try { await fn(); } catch (err) { setError(err.message); }
    setBusy(false);
  }

  const submit = (e) => {
    e.preventDefault();
    if (step === 'email') run(async () => {
      await auth.sendRecoveryCode(recovery.trim().toLowerCase());
      setStep('code'); setInfo(`We sent a 6-digit code to ${recovery}. Check Spam too.`);
    });
    else if (step === 'code') run(async () => {
      await auth.verifyRecoveryCode(code);
      setStep('password'); setInfo('Recovery email verified.');
    });
    else run(async () => {
      if (password !== confirm) throw new Error('Passwords don’t match');
      await auth.activate(password);
      onComplete();
    });
  };

  const steps = ['email', 'code', 'password'];
  const idx = steps.indexOf(step);

  return (
    <AuthLayout>
      <form onSubmit={submit} className="auth-form">
        <div className="stepper">
          {['Recovery email', 'Verify', 'Password'].map((s, i) => (
            <div key={s} className={`step ${i < idx ? 'done' : i === idx ? 'current' : ''}`}>
              <b>{i < idx ? <CheckCircle2 size={14} /> : i + 1}</b>{s}
            </div>
          ))}
        </div>
        <h1>
          {step === 'email' ? 'Secure your account' : step === 'code' ? 'Enter the code' : 'Create your password'}
        </h1>
        <p className="muted">
          {step === 'email' && 'Add a personal email (like Gmail). It’s used only if you forget your password.'}
          {step === 'code' && 'Type the 6-digit code from your recovery email. It expires in 10 minutes.'}
          {step === 'password' && 'Replace the temporary password from your admin with one only you know.'}
        </p>

        {step === 'email' && (
          <>
            <label className="label">Personal recovery email</label>
            <div className="input-wrap">
              <Mail size={16} className="input-icon" />
              <input type="email" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="you@gmail.com" required autoFocus />
            </div>
          </>
        )}
        {step === 'code' && (
          <>
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              required
              autoFocus
            />
            <button type="button" className="text-btn" onClick={() => { setStep('email'); setCode(''); setInfo(''); }}>
              Use a different email
            </button>
          </>
        )}
        {step === 'password' && (
          <>
            <label className="label">New password</label>
            <PasswordInput value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
            <PasswordStrength value={password} />
            <label className="label">Confirm password</label>
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat password" autoComplete="new-password" />
          </>
        )}

        {error && <div className="alert error">{error}</div>}
        {info && <div className="alert success"><CheckCircle2 size={16} /> {info}</div>}
        <button className="btn primary block" disabled={busy}>
          {busy ? <Spinner /> : step === 'email' ? 'Send code' : step === 'code' ? 'Verify' : 'Finish setup'}
        </button>
        <p className="fine">
          Signed in as <b>{user.email}</b> · <button type="button" className="text-btn" onClick={() => auth.signOut()}>Sign out</button>
        </p>
      </form>
    </AuthLayout>
  );
}
