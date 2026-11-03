import { h, icon, avatar, toast } from './dom.js';
import * as api from './api.js';
import { loginView, foundView, inviteView } from './views/auth.js';
import { homeView } from './views/home.js';
import { familyView } from './views/family.js';
import { profileView } from './views/profile.js';
import { calendarView } from './views/calendar.js';
import { eventEditView } from './views/event-edit.js';
import { notificationsView } from './views/notifications.js';
import { tasksView, taskView, taskEditView } from './views/tasks.js';
import { mealsView, mealView, mealEditView } from './views/meals.js';
import { forgetDevice, refreshPush } from './push.js';

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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0E1824' : '#F5F7FA');
  try { localStorage.setItem(UI_KEY, JSON.stringify({ theme, fontSize: font })); } catch { /* egal */ }
}
try { applyUi(JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch { applyUi(); }

// ---------- Daten ----------
export async function loadData() {
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
const PUBLIC = { '/anmelden': loginView, '/gruenden': foundView, '/einladung': inviteView };
const PRIVATE = {
  '/': homeView, '/kalender': calendarView, '/termin': eventEditView, '/familie': familyView, '/profil': profileView,
  '/meldungen': notificationsView,
  '/aufgaben': tasksView, '/aufgabe': taskView, '/aufgabe-bearbeiten': taskEditView,
  '/essen': mealsView, '/gericht': mealView, '/gericht-bearbeiten': mealEditView,
};
const NAV_OF = { '/termin': '/kalender', '/aufgabe': '/aufgaben', '/aufgabe-bearbeiten': '/aufgaben', '/gericht': '/essen', '/gericht-bearbeiten': '/essen' };

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
  const content = await view({ params });
  if (seq !== renderSeq) return;
  root.replaceChildren(shell(NAV_OF[path] || (path in PRIVATE ? path : '/'), content));
  window.scrollTo(0, 0);
}

function shell(path, content) {
  const nav = (to, ic, label) => h('button', {
    class: 'navbtn', 'aria-current': path === to ? 'page' : null, onClick: () => go(to),
  }, icon(ic, 24), label);

  const top = h('header', { class: 'topbar' }, h('div', { class: 'wrap' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '' }), 'Familienzeit'),
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
    nav('/familie', 'users', 'Familie')));

  return h('div', null, top, h('main', { class: 'wrap with-nav' }, content), bottom);
}

export async function logout() {
  await forgetDevice();
  await api.signOut();
  state.session = null; state.me = null; state.family = null; state.members = []; state.urls = {};
  go('/anmelden');
}

// Nach erfolgreicher Anmeldung oder Registrierung
export async function afterLogin(session) {
  state.session = session;
  await loadData();
  refreshPush();
  go('/');
}

// ---------- Start ----------
async function boot() {
  try {
    state.session = await api.getSession();
    if (state.session) { await loadData(); refreshPush(); }
  } catch (e) {
    console.error(e);
    if (state.session) toast(api.germanError(e), { type: 'error' });
  }

  api.sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      state.session = null; state.me = null;
      setTimeout(() => { if (!PUBLIC[parseHash().path]) go('/anmelden'); }, 0);
    } else if (session) {
      state.session = session;
    }
  });

  window.addEventListener('hashchange', render);
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
