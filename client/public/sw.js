/* Service worker de RunRun: notificaciones push (invitaciones y amigos) aunque la página esté cerrada. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'RunRun', body: event.data?.text() ?? '' };
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Con RunRun en primer plano el aviso ya sale dentro del juego: no duplicarlo.
    const focused = windows.find((w) => w.focused && w.visibilityState === 'visible');
    if (focused) {
      focused.postMessage({ type: 'push', data });
      return;
    }
    const invite = data.kind === 'invite';
    await self.registration.showNotification(data.title || 'RunRun', {
      body: data.body || '',
      tag: data.tag || 'runrun',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      vibrate: invite ? [120, 60, 120, 60, 240] : [100],
      requireInteraction: invite,
      timestamp: Date.now(),
      data: { url: data.url || '/' },
      actions: invite ? [{ action: 'join', title: 'Unirme' }, { action: 'dismiss', title: 'Ahora no' }] : [],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'navigate', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
