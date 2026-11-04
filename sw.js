// Familienzeit Service Worker
// Bei jeder neuen Version VERSION erhöhen, damit Geräte das Update laden.
const VERSION = '1.9.2';
const CACHE = 'familienzeit-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/config.js',
  'js/dom.js',
  'js/api.js',
  'js/app.js',
  'js/views/auth.js',
  'js/views/home.js',
  'js/home-hero.js',
  'js/restore.js',
  'js/ics-export.js',
  'js/ics-share.js',
  'js/views/family.js',
  'js/views/profile.js',
  'js/views/calendar.js',
  'js/views/event-edit.js',
  'js/dates.js',
  'js/recur.js',
  'js/events.js',
  'js/updater.js',
  'js/unzip.js',
  'js/push.js',
  'js/views/notifications.js',
  'js/views/tasks.js',
  'js/comments.js',
  'js/views/meals.js',
  'js/views/shopping.js',
  'js/shopping-parse.js',
  'js/offline.js',
  'js/lock.js',
  'js/settings.js',
  'js/ics.js',
  'js/views/calendar-sync.js',
  'js/zip.js',
  'js/backup.js',
  'js/boot-error.js',
  'js/gestures.js',
  'icons/badge-96.png',
  'icons/shortcut-termin.png',
  'icons/shortcut-aufgabe.png',
  'icons/shortcut-einkauf.png',
  'icons/shortcut-essen.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon.svg',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' umgeht den Browser-Zwischenspeicher, damit wirklich die neuen Dateien geladen werden
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Nur die App-Dateien werden zwischengespeichert, niemals Familiendaten.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isShell = url.origin === location.origin || url.href.startsWith('https://cdn.jsdelivr.net/npm/@supabase/');
  if (!isShell) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

// ---------- Push-Benachrichtigungen ----------
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Familienzeit', body: event.data?.text() || '' }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Familienzeit', {
      body: d.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: 'fz-' + (d.id || Date.now()),
      lang: 'de',
      data: { url: d.url || '#/meldungen', id: d.id || null },
    });
    if (typeof d.unread === 'number' && self.navigator.setAppBadge) {
      try { await self.navigator.setAppBadge(d.unread); } catch { /* egal */ }
    }
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'push' });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = '#/meldungen', id = null } = event.notification.data || {};
  event.waitUntil((async () => {
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        c.postMessage({ type: 'open', url, id });
        return;
      }
    }
    const sep = url.includes('?') ? '&' : '?';
    await self.clients.openWindow(self.registration.scope + url + (id ? `${sep}n=${id}` : ''));
  })());
});
