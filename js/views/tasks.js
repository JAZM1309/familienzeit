import { h, icon, avatar, sheet, toast, field, busy, confirmDialog } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, go, render } from '../app.js';
import { startOfDay, addDays, toDateInput, toTimeInput, fromInputs, fromDateInput, fmtDayShort, fmtTime, fmtDateTime, daysBetween } from '../dates.js';
import { reminderText, nameOf } from '../events.js';
import { commentsBlock, attachmentsBlock } from '../comments.js';

const PRIORITY = { low: 'Niedrig', normal: 'Normal', high: 'Hoch' };
const STATUS = { open: 'Offen', in_progress: 'In Bearbeitung', done: 'Erledigt' };
const PRESETS = [0, 15, 60, 1440];

export const assigneeIds = (t) => (t.task_assignees || []).map((a) => a.user_id);
export function canEditTask(t) {
  const me = state.me.user_id;
  const ids = assigneeIds(t);
  return t.owner_id === me || ids.includes(me) || ids.length === 0;
}
const commentCount = (t) => t.comments?.[0]?.count || 0;

export function dueInfo(t, now = new Date()) {
  if (!t.due_at) return null;
  const d = new Date(t.due_at);
  const diff = daysBetween(now, d);
  const day = diff === 0 ? 'heute' : diff === 1 ? 'morgen' : diff === -1 ? 'gestern' : fmtDayShort(d);
  const overdue = t.status !== 'done' && (t.due_all_day ? diff < 0 : d < now);
  return { text: `Fällig ${day}${t.due_all_day ? '' : ', ' + fmtTime(d)}`, overdue, diff };
}

async function toggleDone(t, onChange) {
  if (!canEditTask(t)) { toast('Abhaken können der Ersteller und die zugewiesenen Personen.', { type: 'error' }); return; }
  const next = t.status === 'done' ? 'open' : 'done';
  try {
    await api.setTaskStatus(t.id, next);
    toast(next === 'done' ? 'Erledigt.' : 'Wieder offen.');
    onChange?.();
  } catch (e) { toast(api.germanError(e), { type: 'error' }); }
}

export function taskItem(t, onChange) {
  const due = dueInfo(t);
  const people = state.members.filter((m) => assigneeIds(t).includes(m.user_id));
  const done = t.status === 'done';
  return h('div', { class: 'task' + (done ? ' done' : '') },
    h('button', {
      class: 'task-check', 'aria-label': done ? `${t.title}: wieder öffnen` : `${t.title}: erledigt`, 'aria-pressed': String(done),
      onClick: () => toggleDone(t, onChange),
    }, done ? icon('check', 16) : null),
    h('button', { class: 'task-main', onClick: () => go(`/aufgabe?id=${t.id}`) },
      h('span', { class: 'task-title' }, t.title),
      h('span', { class: 'task-meta' },
        due ? h('span', { class: due.overdue ? 'overdue' : '' }, icon('clock', 13), due.text) : null,
        t.priority === 'high' && !done ? h('span', { class: 'prio' }, 'Wichtig') : null,
        t.status === 'in_progress' ? h('span', { class: 'pill' }, 'In Bearbeitung') : null,
        commentCount(t) ? h('span', null, icon('text', 13), String(commentCount(t))) : null,
        !people.length ? h('span', null, 'Familie') : null)),
    people.length ? h('div', { class: 'ev-people' }, people.slice(0, 3).map((m) => avatar(m, 24, urlFor(m)))) : null);
}

function sortOpen(a, b) {
  const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
  const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
  if (da !== db) return da - db;
  const pr = { high: 0, normal: 1, low: 2 };
  if (pr[a.priority] !== pr[b.priority]) return pr[a.priority] - pr[b.priority];
  return new Date(b.created_at) - new Date(a.created_at);
}

function group(tasks) {
  const g = { overdue: [], today: [], soon: [], later: [], none: [] };
  for (const t of tasks) {
    const d = dueInfo(t);
    if (!d) g.none.push(t);
    else if (d.overdue) g.overdue.push(t);
    else if (d.diff <= 0) g.today.push(t);
    else if (d.diff <= 7) g.soon.push(t);
    else g.later.push(t);
  }
  return [['Überfällig', g.overdue], ['Heute', g.today], ['Nächste 7 Tage', g.soon], ['Später', g.later], ['Ohne Datum', g.none]]
    .filter(([, l]) => l.length);
}

// ---------- Liste ----------
let filter = 'alle';

export async function tasksView() {
  let tasks = [];
  try { tasks = await api.listTasks(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  const me = state.me.user_id;
  const content = h('div');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter' });

  const draw = () => {
    seg.replaceChildren(...[['alle', 'Alle'], ['meine', 'Meine'], ['familie', 'Familie'], ['erledigt', 'Erledigt']].map(([v, label]) =>
      h('button', { 'aria-pressed': String(v === filter), onClick: () => { filter = v; draw(); } }, label)));
    let list;
    if (filter === 'erledigt') {
      list = tasks.filter((t) => t.status === 'done').sort((a, b) => new Date(b.done_at) - new Date(a.done_at));
      content.replaceChildren(list.length
        ? h('section', { class: 'card' }, list.slice(0, 100).map((t) => taskItem(t, render)))
        : h('p', { class: 'muted', style: { textAlign: 'center', padding: '24px' } }, 'Noch nichts erledigt.'));
      return;
    }
    list = tasks.filter((t) => t.status !== 'done');
    if (filter === 'meine') list = list.filter((t) => assigneeIds(t).includes(me));
    if (filter === 'familie') list = list.filter((t) => assigneeIds(t).length === 0);
    list.sort(sortOpen);
    content.replaceChildren(...(list.length
      ? group(list).map(([title, items]) => h('section', { class: 'card' },
        h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, title),
        items.map((t) => taskItem(t, render))))
      : [h('div', { class: 'card', style: { textAlign: 'center' } },
        h('p', { class: 'muted', style: { marginTop: 0 } }, filter === 'meine' ? 'Dir ist gerade nichts zugewiesen.' : 'Keine offenen Aufgaben.'),
        h('button', { class: 'btn teal small', onClick: () => go('/aufgabe-bearbeiten') }, icon('plus', 18), 'Aufgabe anlegen'))]));
  };
  draw();

  return h('div', null,
    h('div', { class: 'hello' }, h('div', { class: 'grow' }, h('h1', null, 'Aufgaben'))),
    seg, h('div', { style: { height: '12px' } }), content,
    h('button', { class: 'fab', 'aria-label': 'Neue Aufgabe', onClick: () => go('/aufgabe-bearbeiten') }, icon('plus', 28)));
}

// ---------- Detail ----------
const FIELD = { title: 'Titel', description: 'Beschreibung', priority: 'Priorität', status: 'Status', due_at: 'Fälligkeit' };

async function showHistory(t) {
  let rows = [];
  try { rows = await api.taskHistory(t.id); } catch (e) { toast(api.germanError(e), { type: 'error' }); return; }
  const val = (k, v) => v == null ? '–' : k === 'priority' ? PRIORITY[v] : k === 'status' ? STATUS[v] : k === 'due_at' ? fmtDateTime(new Date(v)) : String(v);
  sheet('Verlauf', () => h('div', { class: 'history' }, rows.map((r) => {
    const self = r.actor_id === state.me.user_id;
    let what = r.action === 'created' ? 'hat die Aufgabe erstellt'
      : r.action === 'assignee_added' ? `hat ${nameOf(r.changes?.user_id)} zugewiesen`
        : r.action === 'assignee_removed' ? `hat ${nameOf(r.changes?.user_id)} entfernt` : 'hat geändert';
    if (self) what = what.replace(/^hat /, 'hast ');
    const details = r.action === 'updated' && r.changes ? Object.entries(r.changes).map(([k, v]) =>
      h('li', null, FIELD[k] || k, Array.isArray(v) ? `: ${val(k, v[0])} → ${val(k, v[1])}` : '')) : [];
    return h('div', { class: 'history-row' },
      h('div', null, h('strong', null, nameOf(r.actor_id)), ' ', what),
      details.length ? h('ul', null, details) : null,
      h('div', { class: 'muted small' }, fmtDateTime(new Date(r.at))));
  })));
}

export async function taskView({ params }) {
  let t = null;
  try { t = await api.loadTask(params.get('id')); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  if (!t) {
    return h('div', { class: 'center-state' }, h('div', null,
      h('p', null, 'Diese Aufgabe gibt es nicht mehr.'), h('button', { class: 'btn', onClick: () => go('/aufgaben') }, 'Zu den Aufgaben')));
  }
  const editable = canEditTask(t);
  const due = dueInfo(t);
  const people = state.members.filter((m) => assigneeIds(t).includes(m.user_id));
  const mine = t.task_reminders?.[0]?.offsets || [];
  const row = (ic, ...c) => h('div', { class: 'detail-row' }, h('span', { class: 'detail-ic' }, icon(ic, 18)), h('div', null, ...c));

  const statusSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Status' },
    Object.entries(STATUS).map(([v, label]) => h('button', {
      'aria-pressed': String(v === t.status), disabled: !editable,
      onClick: async () => {
        if (v === t.status) return;
        try { await api.setTaskStatus(t.id, v); render(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
      },
    }, label)));

  const remove = async () => {
    if (!(await confirmDialog({ title: 'Aufgabe löschen?', text: `„${t.title}“ wird mit Kommentaren und Anhängen gelöscht.`, ok: 'Löschen', danger: true }))) return;
    try { await api.deleteTask(t.id); toast('Aufgabe gelöscht.'); go('/aufgaben'); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  };

  const created = new Date(t.created_at);
  const updated = new Date(t.updated_at);
  return h('div', null,
    h('div', { class: 'hello' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onClick: () => go('/aufgaben') }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { class: t.status === 'done' ? 'struck' : '', style: { fontSize: '1.35rem' } }, t.title))),
    h('section', { class: 'card' },
      statusSeg,
      t.status === 'done' && t.done_at ? h('p', { class: 'muted small', style: { margin: '8px 0 0' } },
        `Erledigt von ${t.done_by === state.me.user_id ? 'dir' : nameOf(t.done_by)} · ${fmtDateTime(new Date(t.done_at))}`) : null,
      h('div', { style: { height: '6px' } }),
      row('clock', due ? h('span', { class: due.overdue ? 'overdue' : '' }, due.text) : 'Ohne Fälligkeit'),
      row('users', people.length
        ? h('div', { class: 'chips' }, people.map((m) => h('span', { class: 'chip' }, avatar(m, 22, urlFor(m)), m.display_name)))
        : 'Ganze Familie'),
      row('info', `Priorität: ${PRIORITY[t.priority]}`),
      t.due_at ? row('bell', mine.length ? mine.map(reminderText).join(', ') : 'Keine Erinnerung',
        h('div', { class: 'muted small' }, 'Deine persönliche Erinnerung')) : null,
      t.description ? row('text', h('div', { class: 'pre' }, t.description)) : null,
      h('div', { class: 'meta' },
        `Erstellt von ${t.owner_id === state.me.user_id ? 'dir' : nameOf(t.owner_id)} · ${fmtDateTime(created)}`,
        updated - created > 2000 ? h('br') : null,
        updated - created > 2000 ? `Zuletzt geändert von ${t.updated_by === state.me.user_id ? 'dir' : nameOf(t.updated_by)} · ${fmtDateTime(updated)}` : null,
        h('button', { class: 'link-btn', onClick: () => showHistory(t) }, 'Verlauf anzeigen')),
      editable
        ? h('div', { class: 'btn-row', style: { marginTop: '14px' } },
          h('button', { class: 'btn', style: { flex: 1 }, onClick: () => go(`/aufgabe-bearbeiten?id=${t.id}`) }, icon('edit', 18), 'Bearbeiten'),
          h('button', { class: 'btn danger', style: { flex: 1 }, onClick: remove }, icon('trash', 18), 'Löschen'))
        : h('p', { class: 'muted small' }, 'Bearbeiten können der Ersteller und die zugewiesenen Personen.')),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('camera', 19)), h('h2', null, 'Anhänge')),
      attachmentsBlock({ taskId: t.id }, editable)),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('text', 19)), h('h2', null, 'Kommentare')),
      commentsBlock({ taskId: t.id })));
}

// ---------- Bearbeiten / Neu ----------
function toggleChip(label, on, onToggle, extra) {
  const b = h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(on) }, extra, label);
  b.addEventListener('click', () => { const now = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(now)); onToggle(now); });
  return b;
}

export async function taskEditView({ params }) {
  const id = params.get('id');
  let t = null;
  if (id) {
    try { t = await api.loadTask(id); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
    if (!t || !canEditTask(t)) {
      return h('div', { class: 'center-state' }, h('div', null,
        h('p', null, t ? 'Diese Aufgabe können nur der Ersteller und die zugewiesenen Personen bearbeiten.' : 'Diese Aufgabe gibt es nicht mehr.'),
        h('button', { class: 'btn', onClick: () => go('/aufgaben') }, 'Zu den Aufgaben')));
    }
  }

  const err = h('div', { class: 'error', role: 'alert', hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const title = h('input', { class: 'input', value: t?.title || '', maxlength: 120, placeholder: 'z. B. Müll rausbringen' });
  const description = h('textarea', { class: 'input', rows: 3, maxlength: 4000, placeholder: 'Optional' });
  description.value = t?.description || '';

  const chosen = new Set(t ? assigneeIds(t) : []);
  const people = h('div', { class: 'chips' }, state.members.map((m) => toggleChip(
    m.user_id === state.me.user_id ? 'Ich' : m.display_name, chosen.has(m.user_id),
    (on) => { if (on) chosen.add(m.user_id); else chosen.delete(m.user_id); }, avatar(m, 22, urlFor(m)))));

  const dueDefault = params.get('datum') ? fromDateInput(params.get('datum')) : null;
  const dueStart = t?.due_at ? new Date(t.due_at) : dueDefault;
  const hasDue = h('input', { type: 'checkbox', checked: !!dueStart, 'aria-label': 'Fälligkeitsdatum' });
  const hasTime = h('input', { type: 'checkbox', checked: !!(t?.due_at && !t.due_all_day), 'aria-label': 'Mit Uhrzeit' });
  const dDate = h('input', { class: 'input', type: 'date', value: toDateInput(dueStart || addDays(startOfDay(new Date()), 1)) });
  const dTime = h('input', { class: 'input', type: 'time', value: t?.due_at && !t.due_all_day ? toTimeInput(new Date(t.due_at)) : '18:00' });
  const dueBox = h('div');
  const reminders = new Set(t?.task_reminders?.[0]?.offsets || []);
  const remWrap = h('div');

  const drawRem = () => {
    const all = [...new Set([...PRESETS, ...reminders])].sort((a, b) => a - b);
    remWrap.replaceChildren(
      h('div', { class: 'chips' },
        toggleChip('Keine', reminders.size === 0, () => { reminders.clear(); drawRem(); }),
        all.map((m) => toggleChip(m === 0 ? 'Bei Fälligkeit' : reminderText(m).replace(' vorher', ''), reminders.has(m),
          (on) => { if (on) reminders.add(m); else reminders.delete(m); drawRem(); }))),
      h('div', { class: 'hint' }, hasTime.checked ? 'Gilt nur für dich.' : 'Gilt nur für dich. Ohne Uhrzeit wird um 9 Uhr am Fälligkeitstag erinnert.'));
  };
  const drawDue = () => {
    dueBox.replaceChildren(...(hasDue.checked ? [
      h('div', { class: 'row2', style: { marginBottom: '12px' } }, dDate, hasTime.checked ? dTime : h('span', { hidden: true })),
      h('div', { class: 'switch-row' }, h('span', null, 'Mit Uhrzeit'), h('label', { class: 'toggle' }, hasTime, h('span'))),
      h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Meine Erinnerung'), remWrap),
    ] : []));
    drawRem();
  };
  hasDue.addEventListener('change', drawDue);
  hasTime.addEventListener('change', drawDue);
  drawDue();

  let priority = t?.priority || 'normal';
  const prioSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Priorität' });
  const drawPrio = () => prioSeg.replaceChildren(...Object.entries(PRIORITY).map(([v, label]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === priority), onClick: () => { priority = v; drawPrio(); } }, label)));
  drawPrio();

  const save = h('button', { class: 'btn teal block', type: 'submit' }, 'Speichern');
  const onSubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!title.value.trim()) return showErr('Bitte einen Titel eingeben.');
    let dueAt = null;
    if (hasDue.checked) {
      if (!dDate.value) return showErr('Bitte ein Datum wählen.');
      dueAt = fromInputs(dDate.value, hasTime.checked ? (dTime.value || '18:00') : null);
    }
    busy(save, true, 'Speichern …');
    try {
      const newId = await api.saveTask({
        id: t?.id, version: t?.version,
        data: {
          title: title.value.trim(), description: description.value.trim(), priority,
          status: t?.status || 'open',
          due_at: dueAt ? dueAt.toISOString() : '', due_all_day: !(hasDue.checked && hasTime.checked),
        },
        assignees: [...chosen],
        reminders: dueAt ? [...reminders].sort((a, b) => a - b) : [],
      });
      toast(t ? 'Aufgabe gespeichert.' : 'Aufgabe angelegt.');
      go(t ? `/aufgabe?id=${t.id}` : (typeof newId === 'string' ? `/aufgabe?id=${newId}` : '/aufgaben'));
    } catch (ex) { showErr(api.germanError(ex)); busy(save, false); }
  };

  return h('div', null,
    h('div', { class: 'hello' },
      h('button', { class: 'iconbtn', 'aria-label': 'Abbrechen', onClick: () => go(t ? `/aufgabe?id=${t.id}` : '/aufgaben') }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { style: { fontSize: '1.35rem' } }, t ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'))),
    h('form', { onSubmit, novalidate: true },
      err,
      h('section', { class: 'card' },
        field('Titel', title),
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Beschreibung'), description)),
      h('section', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Wer'), people,
          h('div', { class: 'hint' }, 'Niemand ausgewählt = Aufgabe für die ganze Familie.')),
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Priorität'), prioSeg)),
      h('section', { class: 'card' },
        h('div', { class: 'switch-row' }, h('span', null, 'Fälligkeitsdatum'), h('label', { class: 'toggle' }, hasDue, h('span'))),
        dueBox),
      save));
}
