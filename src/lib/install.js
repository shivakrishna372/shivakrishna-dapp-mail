// "Install app" support (Android / Windows / Mac via Chrome or Edge; iPhone via Add to Home Screen).
import { isIOS, isStandalone } from './push.js';

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

// Chrome/Edge fire this when the app can be installed. Capture it early (called from main.jsx).
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 'installed' | 'available' (one-tap install) | 'ios' (show Add to Home Screen steps) | 'unavailable'
export function installState() {
  if (isStandalone()) return 'installed';
  if (deferredPrompt) return 'available';
  if (isIOS()) return 'ios';
  return 'unavailable';
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome === 'accepted';
}
