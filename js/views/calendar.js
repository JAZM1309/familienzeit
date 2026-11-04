import { h, icon, avatar, toast } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, go, render } from '../app.js';
import {
  startOfDay, addDays, addMonths, startOfWeek, startOfMonth, sameDay, toDateInput, fromDateInput,
  fmtMonth, fmtDayLong, WEEKDAYS_SHORT,
} from '../dates.js';
import { expandAll, onDay } from '../recur.js';
import { agendaItem, colorsFor, participantIds, FAMILY_COLOR } from '../events.js';
import { calendarMenu } from './calendar-sync.js';
import { swipeZone } from '../gestures.js';

const FILTER_KEY = 'fz-cal-hidden';
function loadHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(FILTER_KEY) || '[]')); } catch { return new Set(); }
}
function saveHidden(set) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify([...set])); } catch { /* egal */ }
}

// Gehört ein Termin zu den eingeblendeten Personen?
function passes(ev, hidden) {
  if (!hidden.size) return true;
  if (ev.visibility === 'private') return !hidden.has(ev.owner_id);
  const ids = participantIds(ev);
  if (!ids.length) return !hidden.has('family');
  return ids.some((id) => !hidden.has(id));
}

function link(view, day) { return `/kalender?v=${view}&d=${toDateInput(day)}`; }

function rangeFor(view, day) {
  if (view === 'day') return [startOfDay(day), addDays(startOfDay(day), 1)];
  if (view === 'week') { const s = startOfWeek(day); return [s, addDays(s, 7)]; }
  const s = startOfWeek(startOfMonth(day));
  const e = addDays(startOfWeek(addDays(startOfMonth(addMonths(day, 1)), -1)), 7);
  return [s, e];
}

function titleFor(view, day) {
  if (view === 'month') return fmtMonth(day);
  if (view === 'day') return fmtDayLong(day);
  const s = startOfWeek(day);
  const e = addDays(s, 6);
  const f = (d, o) => d.toLocaleDateString('de-DE', o);
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}.–${f(e, { day: 'numeric', month: 'long' })}`
    : `${f(s, { day: 'numeric', month: 'short' })} – ${f(e, { day: 'numeric', month: 'short' })}`;
}

function newEventButton(day) {
  return h('button', { class: 'btn ghost small', onClick: () => go(`/termin?datum=${toDateInput(day)}`) },
    icon('plus', 18), 'Termin');
}

function dayList(day, occs, { empty = 'Keine Termine.' } = {}) {
  const items = occs.filter((o) => onDay(o, day));
  return items.length
    ? h('div', { class: 'ev-list' }, items.map((o) => agendaItem(o, render)))
    : h('p', { class: 'muted small', style: { margin: '4px 0' } }, empty);
}

export async function calendarView({ params }) {
  const view = ['month', 'week', 'day'].includes(params.get('v')) ? params.get('v') : 'month';
  const day = params.get('d') ? fromDateInput(params.get('d')) : startOfDay(new Date());
  const today = startOfDay(new Date());
  const hidden = loadHidden();
  const [from, to] = rangeFor(view, day);

  let occs = [];
  try {
    const events = await api.eventsInRange(from, to);
    occs = expandAll(events, from, to);
  } catch (e) {
    toast(api.germanError(e), { type: 'error' });
  }
  const shown = () => occs.filter((o) => passes(o.event, hidden));

  const step = (dir) => {
    const next = view === 'month' ? addMonths(day, dir) : addDays(day, dir * (view === 'week' ? 7 : 1));
    go(link(view, next));
  };
  // Auf dem Kalenderblatt blättert Wischen; darüber (Titel, Ansicht, Filter) wechselt es die Rubrik
  const flip = (el) => swipeZone(el, { left: () => step(1), right: () => step(-1) });

  // Kopf: Titel, Blättern, Heute, Ansicht
  const head = h('div', { class: 'cal-head' },
    h('h1', null, titleFor(view, day)),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onClick: () => step(-1) }, icon('left')),
      h('button', { class: 'btn ghost small', onClick: () => go(link(view, today)) }, 'Heute'),
      h('button', { class: 'iconbtn', 'aria-label': 'Weiter', onClick: () => step(1) }, icon('right')),
      h('button', { class: 'iconbtn', 'aria-label': 'Kalender importieren oder verbinden', onClick: calendarMenu }, icon('link'))));

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' },
    [['month', 'Monat'], ['week', 'Woche'], ['day', 'Tag']].map(([v, label]) =>
      h('button', { 'aria-pressed': String(v === view), onClick: () => go(link(v, day)) }, label)));

  // Personenfilter
  const content = h('div');
  const filter = h('div', { class: 'cal-filter', role: 'group', 'aria-label': 'Nach Personen filtern' });
  const drawFilter = () => {
    const chip = (key, label, el) => h('button', {
      class: 'fchip', 'aria-pressed': String(!hidden.has(key)),
      onClick: () => { if (hidden.has(key)) hidden.delete(key); else hidden.add(key); saveHidden(hidden); drawFilter(); drawContent(); },
    }, el, label);
    filter.replaceChildren(
      ...state.members.map((m) => chip(m.user_id, m.user_id === state.me.user_id ? 'Ich' : m.display_name, avatar(m, 22, urlFor(m)))),
      chip('family', 'Familie', h('span', { class: 'fdot', style: { background: FAMILY_COLOR } })));
  };

  let selected = view === 'month' ? day : null;
  const drawContent = () => {
    const list = shown();
    if (view === 'month') {
      const grid = h('div', { class: 'month' },
        WEEKDAYS_SHORT.map((w) => h('div', { class: 'wd' }, w)));
      for (let d = new Date(from); d < to; d = addDays(d, 1)) {
        const cellDay = new Date(d);
        const items = list.filter((o) => onDay(o, cellDay));
        const colors = [...new Set(items.flatMap((o) => colorsFor(o.event)))].slice(0, 4);
        const cell = h('button', {
          class: 'day' + (cellDay.getMonth() !== day.getMonth() ? ' out' : '') +
            (sameDay(cellDay, today) ? ' today' : '') + (sameDay(cellDay, selected) ? ' sel' : ''),
          'aria-label': `${fmtDayLong(cellDay)}, ${items.length} Termine`,
          'aria-pressed': String(sameDay(cellDay, selected)),
          onClick: () => {
            selected = cellDay;
            history.replaceState(null, '', '#' + link('month', cellDay));
            drawContent();
          },
          onDblclick: () => go(link('day', cellDay)),
        },
        h('span', { class: 'num' }, cellDay.getDate()),
        h('span', { class: 'dots' }, colors.map((c) => h('i', { style: { background: c } }))),
        h('span', { class: 'chips-wide' }, items.slice(0, 2).map((o) =>
          h('span', { class: 'mini', style: { borderColor: colorsFor(o.event)[0] } }, o.title)),
        items.length > 2 ? h('span', { class: 'more' }, `+${items.length - 2}`) : null));
        grid.append(cell);
      }
      content.replaceChildren(
        flip(h('section', { class: 'card cal-card' }, grid)),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, fmtDayLong(selected)), newEventButton(selected)),
          dayList(selected, list)));
    } else if (view === 'week') {
      const s = startOfWeek(day);
      content.replaceChildren(flip(h('section', { class: 'card' },
        Array.from({ length: 7 }, (_, i) => {
          const d = addDays(s, i);
          return h('div', { class: 'week-day' + (sameDay(d, today) ? ' today' : '') },
            h('button', { class: 'week-label', onClick: () => go(link('day', d)) },
              h('strong', null, WEEKDAYS_SHORT[i]), ' ', d.getDate() + '.'),
            dayList(d, list, { empty: '–' }));
        }))));
    } else {
      content.replaceChildren(flip(h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, sameDay(day, today) ? 'Heute' : 'Termine'), newEventButton(day)),
        dayList(day, list, { empty: 'An diesem Tag sind keine Termine eingetragen.' }))));
    }
  };

  drawFilter();
  drawContent();
  try {
    if (matchMedia('(pointer: coarse)').matches && localStorage.getItem('fz-tip-calswipe') !== '1') {
      localStorage.setItem('fz-tip-calswipe', '1');
      setTimeout(() => toast('Tipp: Auf dem Kalender wischen blättert. Oberhalb wischen wechselt die Rubrik.', { duration: 6000 }), 600);
    }
  } catch { /* egal */ }

  return h('div', null,
    head, seg, filter, content,
    h('button', {
      class: 'fab', 'aria-label': 'Neuer Termin',
      onClick: () => go(`/termin?datum=${toDateInput(selected || day)}`),
    }, icon('plus', 28)));
}
