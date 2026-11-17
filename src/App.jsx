import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { loadSecurity, auth } from './lib/api.js';
import { LoginScreen, NewPasswordScreen, SetupScreen } from './components/AuthScreens.jsx';
import { ToastProvider, Spinner } from './components/ui.jsx';
import MailApp from './MailApp.jsx';

function useTheme() {
  const read = () => { try { return localStorage.getItem('dapp-theme') || 'system'; } catch { return 'system'; } };
  const [theme, setThemeState] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const setTheme = (t) => { setThemeState(t); try { localStorage.setItem('dapp-theme', t); } catch { /* ignore */ } };
  return [theme, setTheme];
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [session, setSession] = useState(undefined);
  const [recovering, setRecovering] = useState(false);
  const [security, setSecurity] = useState(undefined);
  const [secError, setSecError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  const refreshSecurity = useCallback(async () => {
    if (!userId) { setSecurity(undefined); return; }
    try {
      setSecError('');
      setSecurity(await loadSecurity(userId));
    } catch (e) {
      setSecError(e.message);
    }
  }, [userId]);
  useEffect(() => { refreshSecurity(); }, [refreshSecurity]);

  let screen;
  if (session === undefined) {
    screen = <div className="boot"><Spinner size={28} /><span>Opening DAPP Mail…</span></div>;
  } else if (recovering && session) {
    screen = <NewPasswordScreen onDone={() => { setRecovering(false); window.history.replaceState(null, '', window.location.pathname); }} />;
  } else if (!session) {
    screen = <LoginScreen />;
  } else if (secError) {
    screen = (
      <div className="boot">
        <p>Couldn’t check your account: {secError}</p>
        <div className="row-end">
          <button className="btn primary" onClick={refreshSecurity}>Try again</button>
          <button className="btn ghost" onClick={() => auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  } else if (security === undefined) {
    screen = <div className="boot"><Spinner size={28} /><span>Checking your account…</span></div>;
  } else if (!security?.first_login_completed) {
    screen = <SetupScreen user={session.user} security={security} onComplete={refreshSecurity} />;
  } else {
    screen = <MailApp key={userId} user={session.user} security={security} theme={theme} setTheme={setTheme} />;
  }

  return <ToastProvider>{screen}</ToastProvider>;
}
