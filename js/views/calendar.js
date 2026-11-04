import { h, icon, avatar, toast, sheet } from '../dom.js';
import { emptyState } from '../art.js';
import { holidayName } from '../holidays.js';
import * as api from '../api.js';
import { state, urlFor, go, render } from '../app.js';
import {
  startOfDay, addDays, addMonths, startOfWeek, startOfMonth, sameDay, toDateInput, fromDateInput,
  fmtMonth, fmtDayLong, fmtTime, WEEKDAYS_SHORT,
} from '../dates.js';
import { expandAll, onDay } from '../recur.js';
import { agendaItem, openEvent, colorsFor, participantIds, FAMILY_COLOR } from '../events.js';
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

function dayList(day, occs, { empty = 'Keine Termine.', art = false } = {}) {
  const items = occs.filter((o) => onDay(o, day));
  if (items.length) return h('div', { class: 'ev-list' }, items.map((o) => agendaItem(o, render)));
  return art
    ? emptyState({ scene: 'kalender', compact: true, title: 'Freier Tag', text: empty })
    : h('p', { class: 'muted small', style: { margin: '4px 0' } }, empty);
}

// ---------- Tagesansicht als Zeitleiste ----------
const HOUR = 52; // Pixel pro Stunde
function timeline(day, occs, today) {
  const d0 = startOfDay(day);
  const d1 = addDays(d0, 1);
  const items = occs.filter((o) => onDay(o, day));
  const allDay = items.filter((o) => o.allDay);
  const timed = items.filter((o) => !o.allDay)
    .map((o) => {
      const s0 = Math.max(o.start, d0), e0 = Math.min(Math.max(o.end, o.start.getTime() + 15 * 60000), d1);
      return { o, top: (s0 - d0) / 3600000 * HOUR, bottom: (e0 - d0) / 3600000 * HOUR };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  // Überschneidungen nebeneinander anordnen
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((end) => end <= it.top + 0.5);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = Math.max(it.bottom, it.top + 22);
      it.col = c;
    }
    for (const it of cluster) it.cols = cols.length;
    cluster = [];
  };
  for (const it of timed) {
    if (it.top >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.bottom, it.top + 22);
  }
  flush();

  const grid = h('div', { class: 'tl-grid', style: { height: 24 * HOUR + 'px' } },
    Array.from({ length: 24 }, (_, hr) => h('button', {
      class: 'tl-hour', style: { top: hr * HOUR + 'px', height: HOUR + 'px' }, 'aria-label': `Neuer Termin um ${hr} Uhr`,
      onClick: () => go(`/termin?datum=${toDateInput(day)}&stunde=${hr}`),
    }, h('span', null, hr ? `${String(hr).padStart(2, '0')}:00` : ''))),
    timed.map(({ o, top, bottom, col, cols }) => {
      const c = colorsFor(o.event)[0];
      const height = Math.max(bottom - top, 22);
      return h('button', {
        class: 'tl-ev' + (height < 40 ? ' short' : ''),
        style: { top: top + 'px', height: height - 2 + 'px', left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, '--c': c },
        onClick: () => openEvent(o, render),
      },
      h('strong', null, o.title),
      h('span', null, `${fmtTime(o.start)}–${fmtTime(o.end)}${o.location ? ' · ' + o.location : ''}`));
    }));
  if (sameDay(day, today)) {
    const now = new Date();
    grid.append(h('div', { class: 'tl-now', style: { top: (now - d0) / 3600000 * HOUR + 'px' } }));
  }
  const first = timed.length ? Math.min(...timed.map((t) => t.top)) : 7 * HOUR;
  const scrollTo = Math.max(0, Math.min(first, sameDay(day, today) ? (new Date() - d0) / 3600000 * HOUR : first) - HOUR);
  const hol = holidayName(day);

  const card = h('section', { class: 'card tl-card' },
    h('div', { class: 'card-head' },
      h('h2', null, sameDay(day, today) ? 'Heute' : fmtDayLong(day), hol ? h('span', { class: 'hol-tag' }, hol) : null),
      newEventButton(day)),
    allDay.length ? h('div', { class: 'tl-allday' }, allDay.map((o) => h('button', {
      class: 'tl-ad', style: { '--c': colorsFor(o.event)[0] }, onClick: () => openEvent(o, render),
    }, o.title))) : null,
    !items.length ? h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, 'Keine Termine – tippe auf eine Uhrzeit, um einen anzulegen.') : null,
    h('div', { class: 'tl-scroll' }, h('div', { class: 'tl-gutter' }), grid));
  requestAnimationFrame(() => { const sc = card.querySelector('.tl-scroll'); if (sc) sc.scrollTop = scrollTo; });
  return card;
}

// Kurzübersicht beim Antippen eines Tages in der Monatsansicht
function daySummary(day, occs) {
  const items = occs.filter((o) => onDay(o, day))
    .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
  sheet(fmtDayLong(day), (close) => {
    const allDay = items.filter((o) => o.allDay);
    const timed = items.filter((o) => !o.allDay);
    const parts = [items.length === 1 ? '1 Termin' : `${items.length} Termine`];
    if (allDay.length) parts.push(`${allDay.length} ganztägig`);
    if (timed.length) {
      const first = timed[0].start;
      const last = timed.reduce((m, o) => (o.end > m ? o.end : m), timed[0].end);
      const lastShown = sameDay(last, day) ? fmtTime(last) : 'nach Mitternacht';
      parts.push(`${sameDay(first, day) ? fmtTime(first) : 'ab Vortag'} – ${lastShown}`);
    }
    const row = (o) => {
      const ev = o.event;
      const ids = participantIds(ev);
      const who = ev.visibility === 'private' ? 'Nur für dich'
        : ids.length ? state.members.filter((m) => ids.includes(m.user_id)).map((m) => m.display_name).join(', ') : '';
      const sub = [o.location, who].filter(Boolean).join(' · ');
      const startsHere = sameDay(o.start, day);
      const when = o.allDay ? 'ganztägig' : startsHere ? fmtTime(o.start) : 'bis ' + fmtTime(o.end);
      return h('button', { class: 'ds-row', onClick: () => { close(); openEvent(o, render); } },
        h('span', { class: 'ds-time' + (o.allDay ? ' ad' : '') }, when),
        h('span', { class: 'ds-dots' }, colorsFor(ev).slice(0, 3).map((c) => h('i', { style: { background: c } }))),
        h('span', { class: 'ds-main' },
          h('span', { class: 'ds-title' }, o.title, ev.visibility === 'private' ? icon('lock', 13) : null),
          sub ? h('span', { class: 'ds-sub' }, sub) : null),
        icon('right', 16));
    };
    const hol = holidayName(day);
    return h('div', { class: 'day-sum' },
      hol ? h('p', { class: 'ds-hol' }, h('span', { class: 'hol-tag', style: { marginLeft: 0 } }, hol), ' Feiertag') : null,
      items.length
        ? [h('p', { class: 'ds-meta' }, parts.join(' · ')), h('div', { class: 'ds-list' }, items.map(row))]
        : h('p', { class: 'muted', style: { margin: '4px 0 12px' } }, 'An diesem Tag sind keine Termine eingetragen.'),
      h('div', { class: 'ds-actions' },
        h('button', { class: 'btn ghost', onClick: () => { close(); go(link('day', day)); } }, icon('calendar', 18), 'Tagesansicht'),
        h('button', { class: 'btn', onClick: () => { close(); go(`/termin?datum=${toDateInput(day)}`); } }, icon('plus', 18), 'Termin')));
  });
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
      h('button', { class: 'iconbtn', 'aria-label': 'Kalender importieren, verbinden oder exportieren', onClick: calendarMenu }, icon('link'))));

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
        const hol = holidayName(cellDay);
        const wd = (cellDay.getDay() + 6) % 7;
        const cell = h('button', {
          class: 'day' + (cellDay.getMonth() !== day.getMonth() ? ' out' : '') + (wd >= 5 ? ' we' : '') + (hol ? ' hol' : '') +
            (sameDay(cellDay, today) ? ' today' : '') + (sameDay(cellDay, selected) ? ' sel' : ''),
          title: hol || null,
          'aria-label': `${fmtDayLong(cellDay)}${hol ? ', ' + hol : ''}, ${items.length} Termine`,
          'aria-pressed': String(sameDay(cellDay, selected)),
          onClick: () => {
            selected = cellDay;
            history.replaceState(null, '', '#' + link('month', cellDay));
            drawContent();
            daySummary(cellDay, shown());
          },
          onDblclick: () => go(link('day', cellDay)),
        },
        h('span', { class: 'num' }, cellDay.getDate()),
        h('span', { class: 'bars' }, items.slice(0, 3).map((o) => h('i', { style: { background: colorsFor(o.event)[0] } })),
          items.length > 3 ? h('b', null, `+${items.length - 3}`) : null),
        h('span', { class: 'chips-wide' }, items.slice(0, 2).map((o) =>
          h('span', { class: 'mini', style: { borderColor: colorsFor(o.event)[0] } }, o.title)),
        items.length > 2 ? h('span', { class: 'more' }, `+${items.length - 2}`) : null));
        grid.append(cell);
      }
      content.replaceChildren(
        flip(h('section', { class: 'card cal-card' }, grid)),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, fmtDayLong(selected),
            holidayName(selected) ? h('span', { class: 'hol-tag' }, holidayName(selected)) : null), newEventButton(selected)),
          dayList(selected, list, { empty: 'An diesem Tag ist nichts eingetragen.', art: true })));
    } else if (view === 'week') {
      const s = startOfWeek(day);
      content.replaceChildren(flip(h('section', { class: 'card' },
        Array.from({ length: 7 }, (_, i) => {
          const d = addDays(s, i);
          return h('div', { class: 'week-day' + (sameDay(d, today) ? ' today' : '') },
            h('button', { class: 'week-label' + (holidayName(d) ? ' hol' : ''), onClick: () => go(link('day', d)) },
              h('strong', null, WEEKDAYS_SHORT[i]), ' ', d.getDate() + '.',
              holidayName(d) ? h('span', { class: 'hol-mini' }, holidayName(d)) : null),
            dayList(d, list, { empty: '–' }));
        }))));
    } else {
      content.replaceChildren(flip(timeline(day, list, today)));
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
