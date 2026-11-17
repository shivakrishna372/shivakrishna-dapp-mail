// DAPP Mail service worker: shows new-mail notifications, even when the app is closed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }

  event.waitUntil((async () => {
    if (self.navigator.setAppBadge && typeof data.unread === 'number') {
      try { data.unread ? await self.navigator.setAppBadge(data.unread) : await self.navigator.clearAppBadge(); } catch { /* not supported */ }
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach((w) => w.postMessage({ type: 'new-mail', threadId: data.threadId }));

    // Always show a notification (iPhone/Safari requires one for every push).
    await self.registration.showNotification(data.title || 'DAPP Mail', {
      body: data.body || 'You have a new message',
      tag: data.tag || 'dapp-mail',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      vibrate: [120, 60, 120],
      data: { threadId: data.threadId || null },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const threadId = event.notification.data && event.notification.data.threadId;
  const target = threadId ? `/?thread=${encodeURIComponent(threadId)}` : '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        w.postMessage({ type: 'open-thread', threadId });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
