// Web push: lets this device show notifications for new mail, even when the app is closed.
import { supabase } from '../supabase.js';

// Public key only (safe to ship). The private key lives in Supabase Vault.
const VAPID_PUBLIC_KEY = 'BLuXCkL_ENIEuT1QuuOMyC33_5nRv222RwYitN28H--vHO8RqxN8XqpSEBQzmujL9pZPQwzNYPiD59Qml9AAiTc';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// 'unsupported' | 'needs-install' (iPhone not added to Home Screen) | 'blocked' | 'off' | 'on'
export async function pushStatus() {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null; // e.g. preview environments that block service workers
  }
}

function keyToBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('claim_push_subscription', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys.p256dh,
    p_auth: j.keys.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

// Ask permission (must be called from a button click) and register this device.
export async function enablePush() {
  if (!pushSupported()) throw new Error(isIOS() ? 'On iPhone, first add DAPP Mail to your Home Screen' : 'This browser does not support notifications');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. You can enable them in your browser settings.');
  const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) });
  }
  await saveSubscription(sub);
}

// Stop notifications on this device.
export async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// On every app start: if this device already allowed notifications, make sure the server knows it
// belongs to the person who is signed in now.
export async function syncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await saveSubscription(sub);
  } catch { /* ignore */ }
}

// Before signing out: stop sending this person's mail notifications to this device,
// but keep the device's permission so the next sign-in reconnects automatically (syncPush).
export async function forgetDevice() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  } catch { /* ignore */ }
}

export async function showTestNotification() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('DAPP Mail', {
    body: 'Notifications are working on this device 🎉',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: 'dapp-test',
  });
}

export function setBadge(count) {
  try {
    if (!navigator.setAppBadge) return;
    if (count) navigator.setAppBadge(count); else navigator.clearAppBadge();
  } catch { /* ignore */ }
}
