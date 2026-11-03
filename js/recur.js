// Wiederholungen: Serien werden erst in der App für den sichtbaren Zeitraum aufgefaltet.
import { startOfDay, addDays, startOfWeek, daysBetween, fromDateInput, fmtDate, WEEKDAYS_SHORT } from './dates.js';

export const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']; // Montag zuerst
const DAY_MS = 86400000;

export function dayCode(d) { return DAY_CODES[(d.getDay() + 6) % 7]; }

export function parseRule(rrule) {
  if (!rrule) return null;
  const p = Object.fromEntries(rrule.split(';').map((x) => x.split('=')));
  return { freq: p.FREQ, interval: Math.max(1, Number(p.INTERVAL || 1)), byday: p.BYDAY ? p.BYDAY.split(',') : [] };
}

export function buildRule({ freq, interval = 1, byday = [] }) {
  if (!freq) return null;
  let r = 'FREQ=' + freq;
  if (interval > 1) r += ';INTERVAL=' + interval;
  if (freq === 'WEEKLY' && byday.length) r += ';BYDAY=' + DAY_CODES.filter((c) => byday.includes(c)).join(',');
  return r;
}

function atTimeOf(day, ref) {
  const d = new Date(day);
  d.setHours(ref.getHours(), ref.getMinutes(), 0, 0);
  return d;
}

// Startzeitpunkte einer Serie, die den Bereich [from, to) berühren
export function seriesStarts(start, rule, untilDate, from, to, dur) {
  const out = [];
  const stop = untilDate && addDays(untilDate, 1) < to ? addDays(untilDate, 1) : to;
  const durDays = Math.ceil(dur / DAY_MS) + 1;
  const n = rule.interval;
  const take = (d) => { if (d >= start && d < stop && d.getTime() + Math.max(dur, 1) > from.getTime()) out.push(d); };
  let guard = 0;

  if (rule.freq === 'DAILY') {
    const skip = daysBetween(start, from) - durDays;
    let k = skip > 0 ? Math.floor(skip / n) * n : 0;
    for (; guard++ < 4000; k += n) {
      const d = atTimeOf(addDays(startOfDay(start), k), start);
      if (d >= stop) break;
      take(d);
    }
  } else if (rule.freq === 'WEEKLY') {
    const codes = rule.byday.length ? rule.byday : [dayCode(start)];
    const offsets = DAY_CODES.map((c, i) => (codes.includes(c) ? i : -1)).filter((i) => i >= 0);
    const week0 = startOfWeek(start);
    const skipWeeks = Math.floor((daysBetween(week0, from) - durDays) / 7) - 1;
    let w = skipWeeks > 0 ? Math.floor(skipWeeks / n) * n : 0;
    outer: for (; guard++ < 2000; w += n) {
      for (const off of offsets) {
        const d = atTimeOf(addDays(week0, w * 7 + off), start);
        if (d >= stop) break outer;
        take(d);
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let m = 0; guard++ < 1200; m += n) {
      const d = new Date(start.getFullYear(), start.getMonth() + m, start.getDate(), start.getHours(), start.getMinutes());
      if (d >= stop) break;
      if (d.getDate() === start.getDate()) take(d); // 31. gibt es nicht in jedem Monat
    }
  } else if (rule.freq === 'YEARLY') {
    for (let y = 0; guard++ < 200; y += n) {
      const d = new Date(start.getFullYear() + y, start.getMonth(), start.getDate(), start.getHours(), start.getMinutes());
      if (d >= stop) break;
      if (d.getMonth() === start.getMonth()) take(d); // 29. Februar
    }
  }
  return out;
}

function pick(x, key, fallback) {
  return x && x[key] != null ? x[key] : fallback;
}

function makeOcc(ev, start, end, originalStart, x) {
  return {
    key: ev.id + '|' + (originalStart ? originalStart.getTime() : 'single'),
    event: ev,
    start, end,
    originalStart,
    exception: x || null,
    title: pick(x, 'title', ev.title),
    location: pick(x, 'location', ev.location) || '',
    description: pick(x, 'description', ev.description) || '',
    allDay: pick(x, 'all_day', ev.all_day),
  };
}

// Alle Vorkommen eines Termins im Bereich [from, to)
export function occurrences(ev, from, to) {
  const start = new Date(ev.starts_at);
  const end = new Date(ev.ends_at);
  const dur = end - start;

  if (!ev.rrule) {
    return (end > from || (dur === 0 && start >= from)) && start < to ? [makeOcc(ev, start, end, null, null)] : [];
  }

  const rule = parseRule(ev.rrule);
  const until = ev.until ? fromDateInput(ev.until) : null;
  const exc = new Map((ev.event_exceptions || []).map((x) => [new Date(x.original_start).getTime(), x]));
  const out = [];
  for (const s of seriesStarts(start, rule, until, from, to, dur)) {
    const x = exc.get(s.getTime());
    if (x?.cancelled) continue;
    const s2 = x?.starts_at ? new Date(x.starts_at) : s;
    const e2 = x?.ends_at ? new Date(x.ends_at) : new Date(s.getTime() + dur);
    if (e2 <= from && !(e2.getTime() === s2.getTime() && s2 >= from)) continue;
    if (s2 >= to) continue;
    out.push(makeOcc(ev, s2, e2, s, x));
  }
  return out;
}

export function expandAll(events, from, to) {
  return events.flatMap((ev) => occurrences(ev, from, to)).sort((a, b) =>
    (b.allDay - a.allDay) || (a.start - b.start) || a.title.localeCompare(b.title, 'de'));
}

export function onDay(occ, day) {
  const d0 = startOfDay(day);
  const d1 = addDays(d0, 1);
  if (occ.start.getTime() === occ.end.getTime()) return occ.start >= d0 && occ.start < d1;
  return occ.start < d1 && occ.end > d0;
}

// Lesbarer Text, z. B. "Alle 2 Wochen am Di, Do bis 31. Dezember 2026"
export function ruleText(rrule, until, start) {
  const r = parseRule(rrule);
  if (!r) return '';
  const n = r.interval;
  const days = (r.byday.length ? r.byday : [dayCode(start)])
    .map((c) => WEEKDAYS_SHORT[DAY_CODES.indexOf(c)]).join(', ');
  let t = '';
  if (r.freq === 'DAILY') t = n === 1 ? 'Täglich' : `Alle ${n} Tage`;
  if (r.freq === 'WEEKLY') t = (n === 1 ? 'Wöchentlich' : `Alle ${n} Wochen`) + ` am ${days}`;
  if (r.freq === 'MONTHLY') t = (n === 1 ? 'Monatlich' : `Alle ${n} Monate`) + ` am ${start.getDate()}.`;
  if (r.freq === 'YEARLY') t = (n === 1 ? 'Jährlich' : `Alle ${n} Jahre`) + ' am ' +
    new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' }).format(start);
  if (until) t += ` bis ${fmtDate(fromDateInput(until))}`;
  return t;
}
