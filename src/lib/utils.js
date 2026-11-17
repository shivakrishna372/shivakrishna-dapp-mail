import DOMPurify from 'dompurify';

export const DOMAIN = 'dapp.com';

// ---- HTML safety -------------------------------------------------------
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'p', 'div', 'span', 'br',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'hr', 'font',
  ],
  ALLOWED_ATTR: ['href', 'title', 'class', 'color', 'style'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
  // Only allow harmless inline styles (colour / weight / alignment).
  if (node.hasAttribute && node.hasAttribute('style')) {
    const safe = (node.getAttribute('style') || '')
      .split(';')
      .map((d) => d.trim())
      .filter((d) =>
        /^(color|background-color|font-weight|font-style|text-decoration|text-align)\s*:\s*[#\w\s(),.%-]+$/i.test(d)
      )
      .join('; ');
    if (safe) node.setAttribute('style', safe);
    else node.removeAttribute('style');
  }
});

export function sanitize(html) {
  return DOMPurify.sanitize(html || '', PURIFY_CONFIG);
}

export function htmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = sanitize(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h\d)>/gi, '\n');
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function textToHtml(text) {
  return escapeHtml(text || '').replace(/\n/g, '<br>');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- People ------------------------------------------------------------
const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#2563eb', '#0d9488', '#ea580c'];

export function avatarColor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name = '') {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export function displayName(p) {
  return p?.display_name || p?.email?.split('@')[0] || 'Unknown';
}

export function firstName(p) {
  return displayName(p).split(' ')[0];
}

// ---- Dates -------------------------------------------------------------
export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  const base = d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (diff < 60) return `${base} (just now)`;
  if (diff < 3600) return `${base} (${Math.floor(diff / 60)} min ago)`;
  if (diff < 86400) return `${base} (${Math.floor(diff / 3600)} hr ago)`;
  return base;
}

export function friendlyFuture(iso) {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow, ${time}`;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Preset times used by Snooze and Schedule send.
export function presetTimes() {
  const now = new Date();
  const at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now); monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const list = [];
  if (now.getHours() < 17) list.push({ label: 'Later today', date: at(now, 18) });
  list.push({ label: 'Tomorrow morning', date: at(tomorrow, 8) });
  list.push({ label: 'Tomorrow afternoon', date: at(tomorrow, 13) });
  list.push({ label: 'Next week', date: at(monday, 8) });
  return list;
}

export function toLocalInput(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ---- Files -------------------------------------------------------------
export function fileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function safeFileName(name) {
  return name.replace(/[^\w.\- ()]+/g, '_').slice(-120) || 'file';
}

export function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
