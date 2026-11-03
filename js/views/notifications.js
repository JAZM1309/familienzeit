import { h, icon, toast, confirmDialog } from '../dom.js';
import * as api from '../api.js';
import { go, refreshUnread } from '../app.js';
import { fmtTime, fmtDayShort, daysBetween } from '../dates.js';

const TYPE = {
  event_new: { icon: 'calendar', group: 'termine' },
  event_changed: { icon: 'edit', group: 'termine' },
  event_cancelled: { icon: 'x', group: 'termine' },
  event_deleted: { icon: 'trash', group: 'termine' },
  reminder: { icon: 'bell', group: 'termine' },
  test: { icon: 'check', group: 'termine' },
  task_new: { icon: 'tasks', group: 'aufgaben' },
  task_assigned: { icon: 'user', group: 'aufgaben' },
  task_done: { icon: 'check', group: 'aufgaben' },
  task_reminder: { icon: 'bell', group: 'aufgaben' },
  comment_new: { icon: 'text', group: null },
  meal_new: { icon: 'meal', group: 'essen' },
  shopping: { icon: 'cart', group: 'einkauf' },
};
const groupOf = (n) => (TYPE[n.type] || TYPE.test).group || (n.task_id ? 'aufgaben' : 'termine');

export function relTime(ts, now = new Date()) {
  const d = new Date(ts);
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const diff = daysBetween(d, now);
  if (diff === 0) return `heute, ${fmtTime(d)}`;
  if (diff === 1) return `gestern, ${fmtTime(d)}`;
  return `${fmtDayShort(d)}, ${fmtTime(d)}`;
}

export function notificationRow(n, onOpen) {
  const t = TYPE[n.type] || TYPE.test;
  return h('button', { class: 'nf-item' + (n.read_at ? '' : ' unread'), onClick: () => onOpen(n) },
    h('span', { class: 'card-icon' }, icon(t.icon, 18)),
    h('span', { class: 'nf-main' },
      h('span', { class: 'nf-title' }, n.title),
      n.body ? h('span', { class: 'nf-body' }, n.body) : null,
      h('span', { class: 'nf-time' }, relTime(n.created_at))),
    n.read_at ? null : h('span', { class: 'nf-dot', 'aria-label': 'ungelesen' }));
}

export async function openNotification(n) {
  if (!n.read_at) {
    try { await api.markRead([n.id]); } catch { /* egal */ }
    refreshUnread();
  }
  if (n.url && n.url !== '#/meldungen') go(n.url.replace(/^#/, ''));
}

let filter = 'alle';

export async function notificationsView() {
  let rows = [];
  try { rows = await api.listNotifications(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }

  const list = h('div', { class: 'nf-list' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter' });
  const draw = () => {
    seg.replaceChildren(...[['alle', 'Alle'], ['ungelesen', 'Ungelesen'], ['termine', 'Termine'], ['aufgaben', 'Aufgaben']]
      .map(([v, label]) => h('button', { 'aria-pressed': String(v === filter), onClick: () => { filter = v; draw(); } }, label)));
    const shown = rows.filter((n) => filter === 'alle' || (filter === 'ungelesen' ? !n.read_at : groupOf(n) === filter));
    list.replaceChildren(...(shown.length
      ? shown.map((n) => notificationRow(n, async (x) => { await openNotification(x); x.read_at = x.read_at || new Date().toISOString(); draw(); }))
      : [h('p', { class: 'muted', style: { textAlign: 'center', padding: '24px 0', margin: 0 } },
        filter === 'ungelesen' ? 'Alles gelesen.' : 'Noch keine Benachrichtigungen.')]));
  };
  draw();

  const unread = rows.some((n) => !n.read_at);
  return h('div', null,
    h('div', { class: 'hello' },
      h('div', { class: 'grow' }, h('h1', { style: { fontSize: '1.35rem' } }, 'Benachrichtigungen')),
      unread ? h('button', {
        class: 'btn ghost small',
        onClick: async () => {
          try { await api.markAllRead(); rows.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); }); refreshUnread(); draw(); }
          catch (e) { toast(api.germanError(e), { type: 'error' }); }
        },
      }, icon('check', 16), 'Alle gelesen') : null),
    seg,
    h('section', { class: 'card', style: { marginTop: '12px' } }, list),
    rows.some((n) => n.read_at) ? h('p', { style: { textAlign: 'center' } }, h('button', {
      class: 'link-btn',
      onClick: async () => {
        if (!(await confirmDialog({ title: 'Gelesene löschen?', text: 'Alle gelesenen Benachrichtigungen werden entfernt.', ok: 'Löschen', danger: true }))) return;
        try { await api.deleteReadNotifications(); rows = rows.filter((n) => !n.read_at); draw(); toast('Gelesene gelöscht.'); }
        catch (e) { toast(api.germanError(e), { type: 'error' }); }
      },
    }, 'Gelesene löschen')) : null);
}
