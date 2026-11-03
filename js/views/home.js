import { h, icon, avatar, sheet, toast } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, go, render } from '../app.js';
import { startOfDay, addDays, toDateInput } from '../dates.js';
import { expandAll } from '../recur.js';
import { agendaItem } from '../events.js';
import { notificationRow, openNotification } from './notifications.js';
import { taskItem, assigneeIds } from './tasks.js';

// Bereiche der Startseite. "version" = ab wann der Bereich Inhalte zeigt.
const SECTIONS = {
  termine:  { title: 'Heutige Termine',       icon: 'calendar', version: null },
  aufgaben: { title: 'Anstehende Aufgaben',   icon: 'tasks',    version: null },
  einkauf:  { title: 'Offene Einkaufsartikel', icon: 'cart',    version: '1.5' },
  essen:    { title: 'Neue Essenswünsche',    icon: 'meal',     version: '1.4' },
  familie:  { title: 'Familienübersicht',     icon: 'users',    version: null },
  meldungen:{ title: 'Benachrichtigungen',    icon: 'bell',     version: null },
};
const DEFAULT_ORDER = ['termine', 'aufgaben', 'einkauf', 'essen', 'familie', 'meldungen'];

export function greeting(d = new Date()) {
  const hr = d.getHours();
  if (hr >= 5 && hr < 11) return 'Guten Morgen';
  if (hr >= 11 && hr < 18) return 'Guten Tag';
  if (hr >= 18 && hr < 22) return 'Guten Abend';
  return 'Gute Nacht';
}

function layout() {
  const saved = state.me.settings?.home || {};
  const order = (saved.order || []).filter((k) => SECTIONS[k]);
  for (const k of DEFAULT_ORDER) if (!order.includes(k)) order.push(k);
  const hidden = new Set((saved.hidden || []).filter((k) => SECTIONS[k]));
  return { order, hidden };
}

let today = [];
let latest = [];
let openTasks = [];

function sectionCard(key) {
  const s = SECTIONS[key];
  const head = h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon(s.icon, 19)), h('h2', null, s.title));

  if (key === 'termine') {
    head.append(h('button', { class: 'link-btn', onClick: () => go('/kalender') }, 'Kalender'));
    return h('section', { class: 'card' }, head,
      today.length
        ? h('div', { class: 'ev-list' }, today.slice(0, 6).map((o) => agendaItem(o, render)),
          today.length > 6 ? h('button', { class: 'link-btn', onClick: () => go('/kalender?v=day') }, `+ ${today.length - 6} weitere`) : null)
        : h('div', { class: 'soon' }, icon('check', 16), 'Heute stehen keine Termine an.'));
  }

  if (key === 'aufgaben') {
    head.append(h('button', { class: 'link-btn', onClick: () => go('/aufgaben') }, 'Alle'));
    return h('section', { class: 'card' }, head,
      openTasks.length
        ? h('div', null, openTasks.map((t) => taskItem(t, render)))
        : h('div', { class: 'soon' }, icon('check', 16), 'Keine anstehenden Aufgaben.'));
  }

  if (key === 'meldungen') {
    head.append(h('button', { class: 'link-btn', onClick: () => go('/meldungen') }, 'Alle'));
    return h('section', { class: 'card' }, head,
      latest.length
        ? h('div', { class: 'nf-list' }, latest.map((n) => notificationRow(n, openNotification)))
        : h('div', { class: 'soon' }, icon('check', 16), 'Keine neuen Benachrichtigungen.'));
  }

  if (key === 'familie') {
    const people = state.members.map((m) => h('button', {
      class: 'person', style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' },
      onClick: () => go('/familie'),
    }, avatar(m, 52, urlFor(m)), h('span', null, m.user_id === state.me.user_id ? 'Du' : m.display_name)));
    const free = 4 - state.members.length;
    return h('section', { class: 'card' }, head,
      h('div', { class: 'family-row' }, people),
      free > 0 ? h('p', { class: 'muted small', style: { margin: '12px 0 0' } },
        free === 1 ? 'Ein Platz ist noch frei.' : `${free} Plätze sind noch frei.`) : null);
  }

  return h('section', { class: 'card' }, head,
    h('div', { class: 'soon' }, icon('clock', 16), `Kommt mit Version ${s.version}.`));
}

function installHint() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let dismissed = false;
  try { dismissed = localStorage.getItem('fz-install-hint') === 'off'; } catch { /* egal */ }
  if (standalone || dismissed) return null;

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const card = h('section', { class: 'card' });
  const close = h('button', {
    class: 'iconbtn', 'aria-label': 'Hinweis schließen',
    onClick: () => { try { localStorage.setItem('fz-install-hint', 'off'); } catch { /* egal */ } card.remove(); },
  }, icon('x', 18));

  const text = ios
    ? 'Tippe in Safari auf „Teilen“ und dann auf „Zum Home-Bildschirm“. Nur so funktionieren später auch Benachrichtigungen.'
    : 'Installiere Familienzeit als App, dann startet sie wie eine normale App vom Startbildschirm.';
  card.append(
    h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('download', 19)), h('h2', null, 'App installieren'), close),
    h('p', { class: 'muted small', style: { margin: 0 } }, text));

  if (!ios && window.__installPrompt) {
    card.append(h('button', {
      class: 'btn teal small', style: { marginTop: '12px' },
      onClick: async () => { window.__installPrompt.prompt(); await window.__installPrompt.userChoice; window.__installPrompt = null; card.remove(); },
    }, 'Jetzt installieren'));
  }
  return card;
}

function quickAdd() {
  sheet('Schnelleingabe', (close) => {
    const item = (ic, label, version) => h('button', { disabled: true },
      h('span', { class: 'card-icon' }, icon(ic, 19)),
      h('strong', null, label),
      h('span', { class: 'muted small' }, `ab Version ${version}`));
    return h('div', { class: 'quick-grid' },
      h('button', { onClick: () => { close(); go(`/termin?datum=${toDateInput(new Date())}`); } },
        h('span', { class: 'card-icon' }, icon('calendar', 19)), h('strong', null, 'Termin'), h('span', { class: 'muted small' }, 'Neuer Kalendereintrag')),
      h('button', { onClick: () => { close(); go('/aufgabe-bearbeiten'); } },
        h('span', { class: 'card-icon' }, icon('tasks', 19)), h('strong', null, 'Aufgabe'), h('span', { class: 'muted small' }, 'Neue Aufgabe')),
      item('meal', 'Essenswunsch', '1.4'),
      item('cart', 'Einkauf', '1.5'));
  });
}

function customize() {
  const { order, hidden } = layout();
  const list = h('div');
  const draw = () => {
    list.replaceChildren(...order.map((key, i) => {
      const s = SECTIONS[key];
      const on = !hidden.has(key);
      const toggle = h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: on, 'aria-label': `${s.title} anzeigen`,
          onChange: (e) => { if (e.target.checked) hidden.delete(key); else hidden.add(key); draw(); } }),
        h('span'));
      const move = (dir) => { const j = i + dir; [order[i], order[j]] = [order[j], order[i]]; draw(); };
      return h('div', { class: 'customize-row' + (on ? '' : ' off') },
        h('div', { class: 'label' }, h('span', { class: 'card-icon' }, icon(s.icon, 18)), s.title),
        h('button', { class: 'iconbtn', 'aria-label': `${s.title} nach oben`, disabled: i === 0, onClick: () => move(-1) }, icon('up', 20)),
        h('button', { class: 'iconbtn', 'aria-label': `${s.title} nach unten`, disabled: i === order.length - 1, onClick: () => move(1) }, icon('down', 20)),
        toggle);
    }));
  };
  draw();

  sheet('Startseite anpassen', (close) => {
    const save = h('button', { class: 'btn block', style: { marginTop: '16px' } }, 'Speichern');
    save.addEventListener('click', async () => {
      save.disabled = true;
      const settings = { ...(state.me.settings || {}), home: { order: [...order], hidden: [...hidden] } };
      try {
        await api.updateMe(state.me.user_id, { settings });
        state.me.settings = settings;
        close();
        render();
        toast('Startseite gespeichert.');
      } catch (e) {
        toast(api.germanError(e), { type: 'error' });
        save.disabled = false;
      }
    });
    return h('div', null,
      h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Blende Bereiche ein oder aus und ändere die Reihenfolge.'),
      list, save);
  });
}

export async function homeView() {
  const now = new Date();
  const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const { order, hidden } = layout();
  const visible = order.filter((k) => !hidden.has(k));

  today = [];
  latest = [];
  openTasks = [];
  if (visible.includes('aufgaben')) {
    try {
      const me = state.me.user_id;
      const soon = Date.now() + 3 * 86400000;
      openTasks = (await api.listTasks())
        .filter((t) => t.status !== 'done' && (assigneeIds(t).includes(me) || assigneeIds(t).length === 0))
        .filter((t) => !t.due_at || new Date(t.due_at).getTime() < soon || t.priority === 'high')
        .sort((a, b) => (a.due_at ? new Date(a.due_at) : Infinity) - (b.due_at ? new Date(b.due_at) : Infinity))
        .slice(0, 5);
    } catch { /* egal */ }
  }
  if (visible.includes('meldungen')) {
    try { latest = (await api.listNotifications(10)).filter((n) => !n.read_at).slice(0, 3); } catch { /* egal */ }
  }
  if (visible.includes('termine')) {
    const from = startOfDay(now);
    const to = addDays(from, 1);
    try { today = expandAll(await api.eventsInRange(from, to), from, to); }
    catch (e) { toast(api.germanError(e), { type: 'error' }); }
  }

  return h('div', null,
    h('div', { class: 'hello' },
      h('div', { class: 'grow' },
        h('h1', null, `${greeting(now)}, ${state.me.display_name}`),
        h('p', null, date)),
      h('button', { class: 'iconbtn', 'aria-label': 'Startseite anpassen', onClick: customize }, icon('sliders'))),
    installHint(),
    visible.length
      ? visible.map(sectionCard)
      : h('div', { class: 'card muted' }, 'Alle Bereiche sind ausgeblendet. Über das Regler-Symbol oben kannst du sie wieder einblenden.'),
    h('button', { class: 'fab', 'aria-label': 'Neuer Eintrag', onClick: quickAdd }, icon('plus', 28)));
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
