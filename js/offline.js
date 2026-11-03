// Offline: zuletzt geladene Daten pro Konto zwischenspeichern und
// Änderungen ohne Netz in einer Warteschlange sammeln.
//
// Datenschutz: Jedes Konto hat eine eigene lokale Datenbank (Name enthält die Nutzer-ID).
// Beim Abmelden wird sie gelöscht. Auf "gemeinsam genutzten Geräten" wird nichts gespeichert.

let userId = null;
let dbPromise = null;
const listeners = new Set();
export const net = { offline: !navigator.onLine, pending: 0 };

function notify() { for (const fn of listeners) { try { fn(net); } catch { /* egal */ } } }
export function onNetChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function sharedDevice() {
  try { return localStorage.getItem('fz-shared-device') === '1'; } catch { return false; }
}
export function setSharedDevice(on) {
  try { localStorage.setItem('fz-shared-device', on ? '1' : '0'); } catch { /* egal */ }
  if (on) clearCache();
}

const dbName = (uid) => `familienzeit-${uid}`;

function openDb() {
  if (!userId || sharedDevice() || !('indexedDB' in window)) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(dbName(userId), 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('outbox', { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then((db) => db && new Promise((resolve) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => resolve(undefined);
    t.onabort = () => resolve(undefined);
  }));
}

export const cacheGet = (key) => tx('kv', 'readonly', (s) => s.get(key));
export const cacheSet = (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key));

export function useAccount(uid) {
  if (uid === userId) return;
  userId = uid;
  dbPromise = null;
  refreshPending();
}

// Beim Abmelden: alles Lokale dieses Kontos löschen
export async function clearCache() {
  const uid = userId;
  if (dbPromise) { try { (await dbPromise)?.close(); } catch { /* egal */ } }
  dbPromise = null;
  if (uid && 'indexedDB' in window) indexedDB.deleteDatabase(dbName(uid));
  net.pending = 0;
  notify();
}

export function forgetAccount() {
  const p = clearCache();
  userId = null;
  return p;
}

export function isNetworkError(e) {
  if (!navigator.onLine) return true;
  const m = String(e?.message || e || '').toLowerCase();
  return e instanceof TypeError || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed') || m.includes('load failed');
}

function setOffline(v) {
  if (net.offline !== v) { net.offline = v; notify(); }
}

// Lesen: aus dem Netz, sonst aus dem Zwischenspeicher
export async function cached(key, fetcher) {
  try {
    const data = await fetcher();
    setOffline(false);
    cacheSet(key, data);
    return data;
  } catch (e) {
    if (isNetworkError(e)) {
      setOffline(true);
      const c = await cacheGet(key);
      if (c !== undefined) return c;
    }
    throw e;
  }
}

// ---------- Warteschlange ----------
const handlers = {};
export function registerHandler(type, fn) { handlers[type] = fn; }

async function refreshPending() {
  const n = await tx('outbox', 'readonly', (s) => s.count());
  net.pending = n || 0;
  notify();
}

export async function enqueue(op) {
  await tx('outbox', 'readwrite', (s) => s.add({ ...op, at: Date.now() }));
  setOffline(true);
  await refreshPending();
}

let flushing = false;
export async function flush(onProblem) {
  if (flushing || !userId) return;
  flushing = true;
  try {
    const db = await openDb();
    if (!db) return;
    const entries = await new Promise((resolve) => {
      const out = [];
      const req = db.transaction('outbox').objectStore('outbox').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
      req.onerror = () => resolve(out);
    });
    for (const [key, op] of entries) {
      try {
        await handlers[op.type]?.(op);
      } catch (e) {
        if (isNetworkError(e)) { setOffline(true); break; }
        onProblem?.(op, e); // z. B. inzwischen gelöscht – nachvollziehbar melden und überspringen
      }
      await tx('outbox', 'readwrite', (s) => s.delete(key));
    }
    if (entries.length) setOffline(false);
  } finally {
    flushing = false;
    await refreshPending();
  }
}

window.addEventListener('online', () => { setOffline(false); notify(); });
window.addEventListener('offline', () => setOffline(true));
