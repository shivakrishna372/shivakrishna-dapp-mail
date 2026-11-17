import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Share, X, Smartphone } from 'lucide-react';
import { Spinner, useToast } from './ui.jsx';
import { pushStatus, enablePush, disablePush, showTestNotification } from '../lib/push.js';
import '../notifications.css';

function usePushStatus() {
  const [status, setStatus] = useState('loading');
  const refresh = useCallback(() => pushStatus().then(setStatus).catch(() => setStatus('unsupported')), []);
  useEffect(() => { refresh(); }, [refresh]);
  return [status, refresh];
}

const IOS_STEPS = 'Open this site in Safari, tap the Share button, choose “Add to Home Screen”, then open DAPP Mail from your Home Screen and turn notifications on.';

// Card in Settings → Notifications
export function NotificationSettings() {
  const toast = useToast();
  const [status, refresh] = usePushStatus();
  const [busy, setBusy] = useState(false);

  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); } catch (e) { toast(e.message, { error: true }); }
    await refresh();
    setBusy(false);
  };

  return (
    <div className="card form-card">
      <h3>Notifications on this device</h3>
      <p className="muted">Get an alert like WhatsApp when someone sends you mail — even when DAPP Mail is closed. Turn it on separately on each phone or computer you use.</p>

      <div className="notif-status">
        {status === 'loading' && <Spinner />}
        {status === 'on' && <><BellRing size={20} className="ok" /><b>On</b><span className="muted">You’ll be notified about new mail on this device.</span></>}
        {status === 'off' && <><BellOff size={20} /><b>Off</b></>}
        {status === 'blocked' && <><BellOff size={20} className="bad" /><b>Blocked</b><span className="muted">Notifications are blocked for this site. Allow them in your browser’s site settings (the lock icon next to the address), then reload.</span></>}
        {status === 'needs-install' && <><Smartphone size={20} /><b>Add to Home Screen first</b><span className="muted">{IOS_STEPS}</span></>}
        {status === 'unsupported' && <><BellOff size={20} /><b>Not supported</b><span className="muted">This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari.</span></>}
      </div>

      <div className="row-end">
        {status === 'on' && (
          <>
            <button className="btn ghost" disabled={busy} onClick={() => run(showTestNotification)}>Send test</button>
            <button className="btn outline" disabled={busy} onClick={() => run(disablePush, 'Notifications turned off on this device')}>Turn off</button>
          </>
        )}
        {status === 'off' && (
          <button className="btn primary" disabled={busy} onClick={() => run(enablePush, 'Notifications are on')}>
            {busy ? <Spinner /> : <><Bell size={16} /> Turn on notifications</>}
          </button>
        )}
      </div>
    </div>
  );
}

// Slim banner at the top of the mail list (until turned on or dismissed)
export function NotificationBanner() {
  const toast = useToast();
  const [status, refresh] = usePushStatus();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('dapp-notif-banner') === 'hidden'; } catch { return false; } });
  const [busy, setBusy] = useState(false);

  if (hidden || !['off', 'needs-install'].includes(status)) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem('dapp-notif-banner', 'hidden'); } catch { /* ignore */ } };

  return (
    <div className="notif-banner">
      <span className="notif-icon">{status === 'needs-install' ? <Share size={18} /> : <Bell size={18} />}</span>
      <div className="notif-text">
        <b>{status === 'needs-install' ? 'Get notified on your iPhone' : 'Get notified about new mail'}</b>
        <span>{status === 'needs-install' ? 'Tap Share → “Add to Home Screen”, then open DAPP Mail from there.' : 'See an alert when someone emails you, even when the app is closed.'}</span>
      </div>
      {status === 'off' && (
        <button
          className="btn primary sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await enablePush(); toast('Notifications are on'); } catch (e) { toast(e.message, { error: true }); }
            await refresh();
            setBusy(false);
          }}
        >
          {busy ? <Spinner size={14} /> : 'Turn on'}
        </button>
      )}
      <button className="icon-btn sm" onClick={dismiss} aria-label="Dismiss"><X size={16} /></button>
    </div>
  );
}
