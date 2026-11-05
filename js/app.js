import { h, icon, avatar, toast } from './dom.js';
import * as api from './api.js';
import { loginView, foundView, inviteView, resetView } from './views/auth.js';
import { homeView } from './views/home.js';
import { familyView } from './views/family.js';
import { profileView } from './views/profile.js';
import { calendarView } from './views/calendar.js';
import { eventEditView } from './views/event-edit.js';
import { notificationsView } from './views/notifications.js';
import { tasksView, taskView, taskEditView } from './views/tasks.js';
import { mealsView, mealView, mealEditView } from './views/meals.js';
import { shoppingView } from './views/shopping.js';
import { importView, feedsView } from './views/calendar-sync.js';
import { forgetDevice, refreshPush } from './push.js';
import { useAccount, forgetAccount, flush, onNetChange, net, sharedDevice } from './offline.js';
import { lockEnabled, showLockScreen, watchBackground } from './lock.js';
import { initGestures, setPageSwipe, takeEnter, setEnter, vibrate } from './gestures.js';
import { voiceButton } from './voice.js';

const root = document.getElementById('app');

export const state = {
  session: null,
  me: null,
  family: null,
  members: [],
  urls: {},          // avatar_path → signierte URL
  unread: 0,
};

// ---------- Darstellung (Thema, Schriftgröße) ----------
const UI_KEY = 'fz-ui';
export function applyUi(settings = {}) {
  const theme = settings.theme || 'auto';
  const font = settings.fontSize || 'm';
  const r = document.documentElement;
  if (theme === 'auto') delete r.dataset.theme; else r.dataset.theme = theme;
  if (font === 'm') delete r.dataset.font; else r.dataset.font = font;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  // Statusleiste: bei fester Wahl beide Einträge auf die gewählte Farbe, sonst je nach System
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((m, i) => m.setAttribute('content', theme === 'auto' ? (i === 0 ? '#F5F7FA' : '#0E1824') : (dark ? '#0E1824' : '#F5F7FA')));
  try { localStorage.setItem(UI_KEY, JSON.stringify({ theme, fontSize: font })); } catch { /* egal */ }
}
try { applyUi(JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch { applyUi(); }

// ---------- Daten ----------
export async function loadData() {
  useAccount(state.session?.user?.id || null);
  const { family, members } = await api.loadFamily();
  state.family = family;
  state.members = members;
  state.me = members.find((m) => m.user_id === state.session?.user?.id) || null;
  const paths = members.map((m) => m.avatar_path).filter(Boolean);
  try { state.urls = await api.signedUrls(paths); } catch { state.urls = {}; }
  if (state.me) applyUi(state.me.settings);
  await refreshUnread();
}

// Zahl ungelesener Meldungen (Glocke, App-Symbol)
export async function refreshUnread() {
  if (!state.session) return;
  try { state.unread = await api.unreadCount(); } catch { return; }
  const dot = document.getElementById('bell-dot');
  if (dot) dot.hidden = state.unread === 0;
  try {
    if (state.unread && navigator.setAppBadge) navigator.setAppBadge(state.unread);
    else if (navigator.clearAppBadge) navigator.clearAppBadge();
  } catch { /* egal */ }
}

export function urlFor(member) {
  return member?.avatar_path ? state.urls[member.avatar_path] : null;
}

export function isAdmin() {
  return !!state.me && state.family?.admin_id === state.me.user_id;
}

// ---------- Routing ----------
const PUBLIC = { '/anmelden': loginView, '/gruenden': foundView, '/einladung': inviteView, '/passwort-neu': resetView };
const PRIVATE = {
  '/': homeView, '/kalender': calendarView, '/termin': eventEditView, '/familie': familyView, '/profil': profileView,
  '/meldungen': notificationsView,
  '/aufgaben': tasksView, '/aufgabe': taskView, '/aufgabe-bearbeiten': taskEditView,
  '/essen': mealsView, '/gericht': mealView, '/gericht-bearbeiten': mealEditView,
  '/einkauf': shoppingView,
  '/kalender-import': importView, '/kalender-abos': feedsView,
};
const NAV_OF = { '/termin': '/kalender', '/kalender-import': '/kalender', '/kalender-abos': '/kalender', '/aufgabe': '/aufgaben', '/aufgabe-bearbeiten': '/aufgaben', '/gericht': '/essen', '/gericht-bearbeiten': '/essen' };

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

export function go(path) {
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const { path, params } = parseHash();

  if (PUBLIC[path]) {
    const view = await PUBLIC[path]({ params });
    if (seq === renderSeq) { root.replaceChildren(view); window.scrollTo(0, 0); }
    return;
  }

  if (!state.session) {
    let open = false;
    try { open = await api.setupOpen(); } catch { /* offline o. ä. */ }
    go(open ? '/gruenden' : '/anmelden');
    return;
  }

  if (!state.me) {
    root.replaceChildren(h('div', { class: 'wrap center-state' }, h('div', null,
      h('p', null, 'Zu diesem Konto gehört keine Familie.'),
      h('button', { class: 'btn', onClick: logout }, 'Abmelden'))));
    return;
  }

  if (params.get('n')) api.markRead([Number(params.get('n'))]).then(refreshUnread).catch(() => {});
  const view = PRIVATE[path] || homeView;
  setPageSwipe(defaultSwipe(path in PRIVATE ? path : '/'));
  const navPath = NAV_OF[path] || (path in PRIVATE ? path : '/');
  // Dauert das Laden spürbar, Platzhalter zeigen statt der alten Seite
  const slow = setTimeout(() => {
    if (seq === renderSeq) { root.replaceChildren(shell(navPath, skeleton(navPath))); window.scrollTo(0, 0); }
  }, 180);
  let content;
  try { content = await view({ params }); } finally { clearTimeout(slow); }
  if (seq !== renderSeq) return;
  root.replaceChildren(shell(navPath, content));
  window.scrollTo(0, 0);
}

// Lade-Platzhalter in Form der kommenden Seite
function skeleton(path) {
  const line = (w, cls = '') => h('span', { class: 'sk-line ' + cls, style: { width: w } });
  const card = (n) => h('div', { class: 'sk-card' }, line('40%', 'strong'), ...Array.from({ length: n }, (_, i) => line(`${88 - i * 14}%`)));
  if (path === '/kalender') {
    return h('div', { class: 'sk', 'aria-busy': 'true', 'aria-label': 'Wird geladen' },
      h('div', { class: 'sk-head' }, line('45%', 'title')),
      h('div', { class: 'sk-card sk-grid' }, ...Array.from({ length: 35 }, () => h('span', { class: 'sk-cell' }))),
      card(2));
  }
  return h('div', { class: 'sk', 'aria-busy': 'true', 'aria-label': 'Wird geladen' },
    h('div', { class: 'sk-banner' }, line('50%', 'title'), line('30%')),
    card(3), card(2), card(3));
}

// Hauptrubriken in der Reihenfolge der unteren Leiste
const SECTIONS = ['/', '/kalender', '/aufgaben', '/essen', '/einkauf'];
const SEC_NAME = { '/': 'start', '/kalender': 'kalender', '/aufgaben': 'aufgaben', '/essen': 'essen', '/einkauf': 'einkauf' };
function defaultSwipe(path) {
  const i = SECTIONS.indexOf(path);
  if (i >= 0) {
    return {
      left: i < SECTIONS.length - 1 ? () => go(SECTIONS[i + 1]) : null,
      right: i > 0 ? () => go(SECTIONS[i - 1]) : null,
    };
  }
  // Unterseiten: nach rechts wischen = zurück
  return { left: null, right: () => (history.length > 1 ? history.back() : go(NAV_OF[path] || '/')) };
}

function shell(path, content) {
  const current = SECTIONS.indexOf(path);
  document.documentElement.dataset.sec = SEC_NAME[path] || 'other';
  const nav = (to, ic, label) => h('button', {
    class: 'navbtn', 'data-sec': SEC_NAME[to], 'aria-current': path === to ? 'page' : null,
    onClick: () => {
      const i = SECTIONS.indexOf(to);
      if (current >= 0 && i >= 0 && i !== current) setEnter(i > current ? 'right' : 'left');
      vibrate(8);
      go(to);
    },
  }, h('span', { class: 'nav-ic' }, icon(ic, 23)), label);

  const top = h('header', { class: 'topbar' }, h('div', { class: 'wrap' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '' }), 'Familienzeit'),
    h('button', {
      class: 'iconbtn', 'aria-label': 'Familie', 'aria-current': path === '/familie' ? 'page' : null,
      onClick: () => go('/familie'),
    }, icon('users')),
    h('button', {
      class: 'iconbtn', 'aria-label': 'Benachrichtigungen', 'aria-current': path === '/meldungen' ? 'page' : null,
      onClick: () => go('/meldungen'),
    }, icon('bell'), h('span', { class: 'badge-dot', id: 'bell-dot', hidden: state.unread === 0 })),
    h('button', { class: 'iconbtn', 'aria-label': 'Mein Profil', onClick: () => go('/profil') },
      avatar(state.me, 32, urlFor(state.me)))));

  const bottom = h('nav', { class: 'bottomnav', 'aria-label': 'Hauptnavigation' }, h('div', { class: 'wrap' },
    nav('/', 'home', 'Start'),
    nav('/kalender', 'calendar', 'Kalender'),
    nav('/aufgaben', 'tasks', 'Aufgaben'),
    nav('/essen', 'meal', 'Essen'),
    nav('/einkauf', 'cart', 'Einkauf')));

  const enter = takeEnter();
  const main = h('main', { class: 'wrap with-nav' + (enter ? ` enter-${enter}` : '') }, content);
  // Sprachbefehl in allen Hauptrubriken
  const voice = SECTIONS.includes(parseHash().path) ? voiceButton() : null;
  return h('div', null, top, netBanner(), main, voice, bottom);
}

// Hinweis bei fehlender Verbindung bzw. wartenden Änderungen
function netBanner() {
  const el = h('div', { class: 'net-banner', role: 'status', id: 'net-banner' });
  const draw = () => {
    const show = net.offline || net.pending > 0;
    el.hidden = !show;
    el.replaceChildren(icon(net.offline ? 'info' : 'repeat', 16), h('span', null,
      net.offline ? 'Offline – du siehst den zuletzt geladenen Stand.' : 'Wird abgeglichen …',
      net.pending ? ` ${net.pending === 1 ? '1 Änderung wartet' : net.pending + ' Änderungen warten'} auf Übertragung.` : ''));
  };
  draw();
  return el;
}
onNetChange(() => {
  const old = document.getElementById('net-banner');
  if (old) old.replaceWith(netBanner());
});

function syncNow() {
  return flush((op, e) => toast(`Eine offline gemachte Änderung konnte nicht übertragen werden (${api.germanError(e)}).`, { type: 'error', duration: 6000 }));
}

export async function logout() {
  await forgetDevice();
  await forgetAccount();
  await api.signOut();
  state.session = null; state.me = null; state.family = null; state.members = []; state.urls = {};
  go('/anmelden');
}

// Nach erfolgreicher Anmeldung oder Registrierung
export async function afterLogin(session) {
  state.session = session;
  await loadData();
  refreshPush();
  syncNow();
  go('/');
}

// ---------- Start ----------
async function boot() {
  try {
    state.session = await api.getSession();
    if (state.session) {
      await loadData();
      if (state.me && lockEnabled(state.me.user_id)) {
        await showLockScreen(state.me.user_id, state.me.display_name, logout);
      }
      refreshPush();
      syncNow().then(() => { if (net.pending === 0) render(); });
    }
  } catch (e) {
    console.error(e);
    if (state.session) toast(api.germanError(e), { type: 'error' });
  }

  api.sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      state.session = null; state.me = null;
      forgetAccount();
      setTimeout(() => { if (!PUBLIC[parseHash().path]) go('/anmelden'); }, 0);
    } else if (session) {
      state.session = session;
    }
  });

  window.addEventListener('hashchange', render);
  initGestures({ refresh: () => (state.session ? loadData().then(render) : render()) });
  window.addEventListener('online', () => { syncNow().then(render); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.session) syncNow(); });
  watchBackground(() => state.me, (u) => showLockScreen(u.user_id, u.display_name, logout));

  // Gemeinsam genutztes Gerät: nach 10 Minuten ohne Bedienung abmelden
  let lastActive = Date.now();
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true });
  const idleCheck = () => {
    if (state.session && sharedDevice() && Date.now() - lastActive > 10 * 60 * 1000) {
      logout();
      toast('Aus Sicherheitsgründen abgemeldet (gemeinsam genutztes Gerät).');
    }
  };
  setInterval(idleCheck, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') idleCheck(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshUnread(); });
  // Nachrichten vom Service Worker: neue Push-Meldung oder Klick auf eine Meldung
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'push') refreshUnread();
    if (e.data?.type === 'open') {
      if (e.data.id) api.markRead([e.data.id]).then(refreshUnread).catch(() => {});
      if (e.data.url) location.hash = e.data.url.replace(/^#/, '');
    }
  });
  await render();
}

boot();

// ---------- Service Worker (Installation, Updates) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      if (!reg) return;
      // Regelmäßig und beim Zurückkehren in die App nach Updates suchen
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 30 * 60 * 1000);
      const offer = (w) => toast('Neue Version verfügbar.', {
        action: 'Neu laden', duration: 0,
        onAction: () => w.postMessage('SKIP_WAITING'),
      });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloaded) { reloaded = true; location.reload(); }
      });
    } catch (e) { console.warn('SW', e); }
  });
}
