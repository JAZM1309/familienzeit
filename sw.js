// Familienzeit Service Worker
// Bei jeder neuen Version VERSION erhöhen, damit Geräte das Update laden.
const VERSION = '1.1.0';
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
  'js/views/family.js',
  'js/views/profile.js',
  'js/views/calendar.js',
  'js/views/event-edit.js',
  'js/dates.js',
  'js/recur.js',
  'js/events.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon.svg',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
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
