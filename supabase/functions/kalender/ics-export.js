// Kopie von app/js/ics-export.js für die Server-Funktion (gleiche Ausgabe wie der Export in der App).
// Familienzeit-Termine als iCalendar-Datei (.ics, RFC 5545) ausgeben.
// Uhrzeiten in deutscher Ortszeit (Europe/Berlin), damit Serien auch über die
// Zeitumstellung hinweg zur richtigen Uhrzeit stattfinden.
import { TZ as HOME_TZ, toWall, fromWall } from '../push/reminders.js';
// Serien-Regeln wie in der App (app/js/recur.js), Wochentag in deutscher Ortszeit
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const dayCode = (d) => DAY_CODES[(toWall(d).getUTCDay() + 6) % 7];
function parseRule(rrule) {
  if (!rrule) return null;
  const p = Object.fromEntries(rrule.split(';').map((x) => x.split('=')));
  return { freq: p.FREQ, interval: Math.max(1, Number(p.INTERVAL || 1)), byday: p.BYDAY ? p.BYDAY.split(',') : [] };
}

const DAY = 86400000;
const pad = (n, l = 2) => String(n).padStart(l, '0');

// Wanduhr-Date (UTC-Felder) → 20261104T180000 bzw. 20261104
const wallDT = (w) => `${w.getUTCFullYear()}${pad(w.getUTCMonth() + 1)}${pad(w.getUTCDate())}T${pad(w.getUTCHours())}${pad(w.getUTCMinutes())}${pad(w.getUTCSeconds())}`;
const wallD = (w) => `${w.getUTCFullYear()}${pad(w.getUTCMonth() + 1)}${pad(w.getUTCDate())}`;
const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const wallDay = (d) => { const w = toWall(d); return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate())); };

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Zeilen nach 75 Bytes falten (UTF-8, ohne Zeichen zu zerschneiden)
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${HOME_TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
  'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
  'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

// Beginn/Ende als Eigenschaften
function when(name, d, allDay) {
  return allDay ? `${name};VALUE=DATE:${wallD(wallDay(d))}` : `${name};TZID=${HOME_TZ}:${wallDT(toWall(d))}`;
}

function endProp(start, end, allDay) {
  if (allDay) {
    const s = wallDay(start);
    let e = wallDay(end);
    if (e <= s) e = new Date(s.getTime() + DAY);
    return `DTEND;VALUE=DATE:${wallD(e)}`;
  }
  return when('DTEND', end < start ? start : end, false);
}

function describe(description, people) {
  const parts = [];
  if (description) parts.push(description);
  if (people.length) parts.push('Mit: ' + people.join(', '));
  return parts.join('\n\n');
}

function rruleLine(ev) {
  const r = parseRule(ev.rrule);
  if (!r || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq)) return null;
  let s = `RRULE:FREQ=${r.freq}`;
  if (r.interval > 1) s += `;INTERVAL=${r.interval}`;
  if (r.freq === 'WEEKLY') s += `;BYDAY=${(r.byday.length ? r.byday : [dayCode(new Date(ev.starts_at))]).join(',')};WKST=MO`;
  if (ev.until) {
    const [y, m, d] = String(ev.until).slice(0, 10).split('-').map(Number);
    s += ev.all_day
      ? `;UNTIL=${y}${pad(m)}${pad(d)}`
      : `;UNTIL=${utc(fromWall(new Date(Date.UTC(y, m - 1, d, 23, 59, 59))))}`;
  }
  return s;
}

function alarms(ev) {
  const offsets = ev.event_reminders?.[0]?.offsets || [];
  return offsets.flatMap((min) => [
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`, `TRIGGER:-PT${Math.max(0, Math.round(min))}M`, 'END:VALARM',
  ]);
}

/**
 * events: Datensätze wie von api.eventsInRange (mit event_participants, event_exceptions, event_reminders)
 * nameOf: (userId) => Anzeigename
 */
export function buildICS(events, { name = 'Familienzeit', nameOf = () => '', now = new Date() } = {}) {
  const stamp = utc(now);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Familienzeit//Familienzeit//DE', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${HOME_TZ}`,
    // Abo: Kalender-Apps sollen alle 15 Minuten nachsehen
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M', ...VTIMEZONE];

  for (const ev of events) {
    const start = new Date(ev.starts_at);
    const end = new Date(ev.ends_at);
    const dur = end - start;
    const uid = `${ev.id}@familienzeit`;
    const people = ev.visibility === 'private' ? [] : (ev.event_participants || []).map((p) => nameOf(p.user_id)).filter(Boolean);
    const common = (title, description, location) => [
      `SUMMARY:${esc(title || 'Termin')}`,
      location ? `LOCATION:${esc(location)}` : null,
      describe(description, people) ? `DESCRIPTION:${esc(describe(description, people))}` : null,
      ev.visibility === 'private' ? 'CLASS:PRIVATE' : null,
    ];

    const master = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`,
      ev.updated_at ? `LAST-MODIFIED:${utc(new Date(ev.updated_at))}` : null,
      ev.created_at ? `CREATED:${utc(new Date(ev.created_at))}` : null,
      when('DTSTART', start, ev.all_day), endProp(start, end, ev.all_day),
      ...common(ev.title, ev.description, ev.location)];

    const overrides = [];
    if (ev.rrule) {
      const rule = rruleLine(ev);
      if (rule) master.push(rule);
      const r = parseRule(ev.rrule);
      const exdates = [];
      // Die App zählt den Beginn nur mit, wenn sein Wochentag zur Regel passt
      if (r?.freq === 'WEEKLY' && r.byday.length && !r.byday.includes(dayCode(start))) exdates.push(start);
      for (const x of ev.event_exceptions || []) {
        const orig = new Date(x.original_start);
        if (x.cancelled) { exdates.push(orig); continue; }
        const xs = x.starts_at ? new Date(x.starts_at) : orig;
        const xe = x.ends_at ? new Date(x.ends_at) : new Date(orig.getTime() + dur);
        const xAll = x.all_day ?? ev.all_day;
        overrides.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`,
          when('RECURRENCE-ID', orig, ev.all_day),
          when('DTSTART', xs, xAll), endProp(xs, xe, xAll),
          ...common(x.title ?? ev.title, x.description ?? ev.description, x.location ?? ev.location),
          ...alarms(ev), 'END:VEVENT');
      }
      for (const d of exdates) master.push(when('EXDATE', d, ev.all_day));
    }
    master.push(...alarms(ev), 'END:VEVENT');
    lines.push(...master, ...overrides);
  }
  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).map(fold).join('\r\n') + '\r\n';
}

export function icsFileName(base) {
  const slug = String(base || 'termine').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'termine';
  return slug + '.ics';
}
