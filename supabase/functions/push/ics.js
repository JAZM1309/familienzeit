// iCalendar (.ics) lesen und in Familienzeit-Termine umwandeln.
// Wird identisch in der App (Import) und in der Server-Funktion (Abo) verwendet.
// Gerechnet wird in deutscher Ortszeit (Europe/Berlin).

export const HOME_TZ = 'Europe/Berlin';
const DAY = 86400000;
const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

// ---------- Zeitzonen ----------
const WINDOWS_TZ = {
  'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw', 'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik', 'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC', 'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest', 'Turkey Standard Time': 'Europe/Istanbul', 'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles',
};

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

export function normalizeTz(tzid) {
  if (!tzid) return HOME_TZ;
  const t = tzid.replace(/^"|"$/g, '').trim();
  if (WINDOWS_TZ[t]) return WINDOWS_TZ[t];
  const m = t.match(/([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/);
  const cand = m ? m[1] : t;
  try { formatter(cand).format(new Date()); return cand; } catch { return HOME_TZ; }
}

// Echter Zeitpunkt → "Wanduhr" in der Zone (als Date mit UTC-Feldern)
export function toWall(d, tz = HOME_TZ) {
  const p = Object.fromEntries(formatter(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

// "Wanduhr" → echter Zeitpunkt
export function fromWall(w, tz = HOME_TZ) {
  let guess = new Date(w.getTime());
  for (let i = 0; i < 4; i++) {
    const diff = toWall(guess, tz).getTime() - w.getTime();
    if (diff === 0) break;
    guess = new Date(guess.getTime() - diff);
  }
  return guess;
}

// ---------- Zeilen und Eigenschaften ----------
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line) {
  // NAME;PARAM=WERT;PARAM="WERT":INHALT
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = head.match(/("[^"]*"|[^;])+/g) || [head];
  const name = parts[0].toUpperCase();
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function cleanText(v, max) {
  let t = unescapeText(v || '');
  if (/<[a-z][\s\S]*>/i.test(t)) {
    t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  }
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function parseICS(text) {
  const lines = unfold(text);
  const events = [];
  let calName = null;
  let cur = null;
  let depth = 0; // verschachtelte Blöcke (VALARM) im VEVENT überspringen
  for (const raw of lines) {
    if (!raw) continue;
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase();
      if (what === 'VEVENT' && !cur) { cur = { props: {} }; depth = 0; } else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      const what = p.value.trim().toUpperCase();
      if (cur && what === 'VEVENT' && depth === 0) { events.push(cur.props); cur = null; } else if (cur) depth--;
      continue;
    }
    if (cur && depth === 0) {
      (cur.props[p.name] ||= []).push(p);
    } else if (!cur && p.name === 'X-WR-CALNAME') {
      calName = cleanText(p.value, 80);
    }
  }
  return { calName, events };
}

// ---------- Datum/Zeit ----------
// Gibt { at: Date (echter Zeitpunkt), allDay: bool, wall: Date (Wanduhr Berlin) } zurück
export function parseDate(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (prop.params.VALUE === 'DATE' || hh === undefined) {
    const wall = new Date(Date.UTC(+y, +mo - 1, +d));
    return { allDay: true, wall, at: fromWall(wall, HOME_TZ) };
  }
  const local = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +(ss || 0)));
  const at = z ? local : fromWall(local, normalizeTz(prop.params.TZID));
  return { allDay: false, at, wall: toWall(at, HOME_TZ) };
}

function parseDuration(v) {
  const m = (v || '').trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * ((+m[2] || 0) * 7 * DAY + (+m[3] || 0) * DAY + (+m[4] || 0) * 3600000 + (+m[5] || 0) * 60000 + (+m[6] || 0) * 1000);
}

const isoDate = (w) => w.toISOString().slice(0, 10);

// ---------- Wiederholungsregeln ----------
export function parseRRule(v) {
  const r = { freq: null, interval: 1, byday: [], bymonthday: [], bymonth: [], bysetpos: [], count: null, until: null, other: [] };
  for (const part of v.split(';')) {
    const [k, val = ''] = part.split('=');
    const key = k.toUpperCase();
    if (key === 'FREQ') r.freq = val.toUpperCase();
    else if (key === 'INTERVAL') r.interval = Math.max(1, parseInt(val, 10) || 1);
    else if (key === 'COUNT') r.count = parseInt(val, 10) || null;
    else if (key === 'UNTIL') r.until = val;
    else if (key === 'BYDAY') r.byday = val.split(',').filter(Boolean).map((x) => {
      const mm = x.toUpperCase().match(/^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/);
      return mm ? { n: mm[1] ? parseInt(mm[1], 10) : 0, wd: mm[2] } : null;
    }).filter(Boolean);
    else if (key === 'BYMONTHDAY') r.bymonthday = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x);
    else if (key === 'BYMONTH') r.bymonth = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x);
    else if (key === 'BYSETPOS') r.bysetpos = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x);
    else if (key === 'WKST' || key === '') { /* ignorieren */ } else r.other.push(key);
  }
  return r;
}

const wdOf = (w) => CODES[(w.getUTCDay() + 6) % 7];
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const at = (y, m, d, ref) => new Date(Date.UTC(y, m, d, ref.getUTCHours(), ref.getUTCMinutes(), ref.getUTCSeconds()));

function monthCandidates(y, m, r, ref) {
  const dim = daysInMonth(y, m);
  let days;
  if (r.bymonthday.length) {
    days = r.bymonthday.map((d) => (d > 0 ? d : dim + d + 1)).filter((d) => d >= 1 && d <= dim);
    if (r.byday.length) days = days.filter((d) => r.byday.some((b) => b.wd === wdOf(at(y, m, d, ref))));
  } else if (r.byday.length) {
    days = [];
    for (const b of r.byday) {
      const all = [];
      for (let d = 1; d <= dim; d++) if (wdOf(at(y, m, d, ref)) === b.wd) all.push(d);
      if (!b.n) days.push(...all);
      else { const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (pick) days.push(pick); }
    }
  } else {
    days = ref.getUTCDate() <= dim ? [ref.getUTCDate()] : [];
  }
  return [...new Set(days)].sort((a, b) => a - b).map((d) => at(y, m, d, ref));
}

function applySetPos(list, r) {
  if (!r.bysetpos.length) return list;
  return r.bysetpos.map((p) => (p > 0 ? list[p - 1] : list[list.length + p])).filter(Boolean).sort((a, b) => a - b);
}

// Alle Starts (Wanduhr) einer Regel bis endW bzw. bis count erreicht
export function expandRule(startW, r, { untilW = null, endW, max = 2000 } = {}) {
  const out = [];
  const stop = untilW && untilW < endW ? untilW : endW;
  const push = (w) => {
    if (w < startW || w > stop) return false;
    if (r.bymonth.length && !r.bymonth.includes(w.getUTCMonth() + 1)) return false;
    out.push(w);
    return r.count && out.length >= r.count;
  };
  const sy = startW.getUTCFullYear();
  const sm = startW.getUTCMonth();
  let guard = 0;
  outer: for (let k = 0; guard++ < 20000; k += r.interval) {
    let cands;
    let periodStart;
    if (r.freq === 'DAILY') {
      periodStart = new Date(Date.UTC(sy, sm, startW.getUTCDate() + k));
      cands = [at(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate(), startW)];
      if (r.byday.length) cands = cands.filter((c) => r.byday.some((b) => b.wd === wdOf(c)));
      if (r.bymonthday.length) cands = cands.filter((c) => r.bymonthday.includes(c.getUTCDate()));
    } else if (r.freq === 'WEEKLY') {
      const monday = new Date(Date.UTC(sy, sm, startW.getUTCDate() - ((startW.getUTCDay() + 6) % 7) + 7 * k));
      periodStart = monday;
      const wds = r.byday.length ? r.byday.map((b) => b.wd) : [wdOf(startW)];
      cands = CODES.map((c, i) => (wds.includes(c) ? at(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + i, startW) : null)).filter(Boolean);
    } else if (r.freq === 'MONTHLY') {
      periodStart = new Date(Date.UTC(sy, sm + k, 1));
      cands = monthCandidates(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), r, startW);
    } else if (r.freq === 'YEARLY') {
      const y = sy + k;
      periodStart = new Date(Date.UTC(y, 0, 1));
      const months = r.bymonth.length ? r.bymonth.map((m) => m - 1) : [sm];
      cands = [];
      for (const m of months) {
        if (!r.bymonthday.length && !r.byday.length) {
          const d = startW.getUTCDate();
          if (d <= daysInMonth(y, m)) cands.push(at(y, m, d, startW));
        } else cands.push(...monthCandidates(y, m, r, startW));
      }
      cands.sort((a, b) => a - b);
    } else break;
    if (periodStart > stop) break;
    for (const c of applySetPos(cands, r)) {
      if (c > stop) break outer;
      if (push(c)) break outer;
      if (out.length >= max) break outer;
    }
  }
  return out;
}

// Kann die App diese Regel direkt speichern? Dann als RRULE-Text, sonst null.
function toAppRule(r, startW) {
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq) || r.other.length || r.bysetpos.length) return null;
  if (r.interval > 999) return null;
  if (r.bymonth.length && !(r.freq === 'YEARLY' && r.bymonth.length === 1 && r.bymonth[0] === startW.getUTCMonth() + 1)) return null;
  if (r.bymonthday.length && !((r.freq === 'MONTHLY' || r.freq === 'YEARLY') && r.bymonthday.length === 1 && r.bymonthday[0] === startW.getUTCDate())) return null;
  let freq = r.freq;
  let days = [];
  if (r.byday.length) {
    if (r.byday.some((b) => b.n)) return null;
    if (freq === 'DAILY' && r.interval === 1) freq = 'WEEKLY';
    if (freq !== 'WEEKLY') return null;
    days = CODES.filter((c) => r.byday.some((b) => b.wd === c));
  }
  let s = 'FREQ=' + freq;
  if (r.interval > 1) s += ';INTERVAL=' + r.interval;
  if (days.length) s += ';BYDAY=' + days.join(',');
  return s;
}

// ---------- Umwandeln ----------
const first = (props, name) => props[name]?.[0] || null;

function exdatesOf(props) {
  const out = [];
  for (const p of props.EXDATE || []) {
    for (const v of p.value.split(',')) {
      const d = parseDate({ value: v, params: p.params });
      if (d) out.push(d.at.getTime());
    }
  }
  return out;
}

function baseFields(props) {
  const s = parseDate(first(props, 'DTSTART'));
  if (!s) return null;
  let end = parseDate(first(props, 'DTEND'));
  let endAt;
  if (end) endAt = end.allDay && s.allDay ? fromWall(end.wall, HOME_TZ) : end.at;
  else {
    const dur = parseDuration(first(props, 'DURATION')?.value);
    endAt = dur != null ? new Date(s.at.getTime() + dur) : new Date(s.at.getTime() + (s.allDay ? DAY : 0));
  }
  if (s.allDay && endAt <= s.at) endAt = fromWall(new Date(s.wall.getTime() + DAY), HOME_TZ);
  if (endAt < s.at) endAt = s.at;
  return {
    title: cleanText(first(props, 'SUMMARY')?.value || '', 120) || '(ohne Titel)',
    description: cleanText(first(props, 'DESCRIPTION')?.value || '', 4000) || null,
    location: cleanText(first(props, 'LOCATION')?.value || '', 200) || null,
    start: s, endAt,
    cancelled: (first(props, 'STATUS')?.value || '').trim().toUpperCase() === 'CANCELLED',
  };
}

const keyOf = (s) => (s.length > 500 ? s.slice(0, 500) : s);

/**
 * Termine aus einer .ics-Datei.
 * opts.from / opts.to: nur Termine, die diesen Zeitraum berühren.
 * Ergebnis: [{ external_uid, title, description, location, starts_at, ends_at, all_day, rrule, until, exceptions, recurring }]
 */
export function icsToEvents(text, { from, to } = {}) {
  const now = Date.now();
  from = from || new Date(now - 30 * DAY);
  to = to || new Date(now + 2 * 365 * DAY);
  const { calName, events } = parseICS(text);
  const byUid = new Map();
  let anon = 0;
  for (const props of events) {
    const uid = (first(props, 'UID')?.value || '').trim() || `ohne-uid-${anon++}`;
    if (!byUid.has(uid)) byUid.set(uid, { masters: [], overrides: [] });
    (first(props, 'RECURRENCE-ID') ? byUid.get(uid).overrides : byUid.get(uid).masters).push(props);
  }

  const out = [];
  const single = (key, f) => {
    if (f.cancelled) return;
    if (f.endAt < from && !(f.endAt.getTime() === f.start.at.getTime() && f.start.at >= from)) return;
    if (f.start.at > to) return;
    out.push({
      external_uid: keyOf(key), title: f.title, description: f.description, location: f.location,
      starts_at: f.start.at.toISOString(), ends_at: f.endAt.toISOString(), all_day: f.start.allDay,
      rrule: null, until: null, exceptions: [], recurring: false,
    });
  };

  for (const [uid, g] of byUid) {
    const overrides = new Map();
    for (const o of g.overrides) {
      const rid = parseDate(first(o, 'RECURRENCE-ID'));
      const f = baseFields(o);
      if (rid && f) overrides.set(rid.at.getTime(), f);
    }

    g.masters.forEach((props, mi) => {
      const f = baseFields(props);
      if (!f || f.cancelled) return;
      const baseKey = g.masters.length > 1 ? `${uid}#${mi}` : uid;
      const rr = first(props, 'RRULE');
      if (!rr) { single(baseKey, f); return; }

      const r = parseRRule(rr.value);
      const dur = f.endAt - f.start.at;
      const startW = f.start.wall;
      let untilW = null;
      if (r.until) {
        const u = parseDate({ value: r.until, params: {} });
        if (u) untilW = u.allDay ? new Date(u.wall.getTime() + DAY - 1000) : toWall(u.at, HOME_TZ);
      }
      const ex = new Set(exdatesOf(props));
      const endW = toWall(to, HOME_TZ);
      const appRule = toAppRule(r, startW);

      if (appRule) {
        // Ende der Serie als Datum
        let until = untilW ? isoDate(untilW) : null;
        if (r.count) {
          const all = expandRule(startW, r, { untilW, endW: new Date(Date.UTC(9999, 0)), max: r.count });
          until = all.length ? isoDate(all[all.length - 1]) : isoDate(startW);
        }
        if (until && new Date(until + 'T23:59:59Z') < new Date(from.getTime() - 2 * DAY)) return;
        if (f.start.at > to) return;
        const exceptions = [];
        for (const t of ex) exceptions.push({ original_start: new Date(t).toISOString(), cancelled: true });
        for (const [t, o] of overrides) {
          if (ex.has(t)) continue;
          exceptions.push(o.cancelled
            ? { original_start: new Date(t).toISOString(), cancelled: true }
            : {
              original_start: new Date(t).toISOString(), cancelled: false, title: o.title, description: o.description,
              location: o.location, starts_at: o.start.at.toISOString(), ends_at: o.endAt.toISOString(), all_day: o.start.allDay,
            });
        }
        exceptions.sort((a, b) => a.original_start.localeCompare(b.original_start));
        out.push({
          external_uid: keyOf(baseKey), title: f.title, description: f.description, location: f.location,
          starts_at: f.start.at.toISOString(), ends_at: f.endAt.toISOString(), all_day: f.start.allDay,
          rrule: appRule, until, exceptions, recurring: true,
        });
        return;
      }

      // Regel, die die App nicht kennt: einzelne Termine im Zeitraum anlegen
      const walls = expandRule(startW, r, { untilW, endW, max: 1500 });
      for (const w of walls) {
        const occ = f.start.allDay ? fromWall(w, HOME_TZ) : fromWall(w, HOME_TZ);
        const t = occ.getTime();
        if (ex.has(t)) continue;
        const o = overrides.get(t);
        if (o) { single(`${baseKey}#${new Date(t).toISOString()}`, o); continue; }
        single(`${baseKey}#${new Date(t).toISOString()}`, { ...f, start: { ...f.start, at: occ, wall: w }, endAt: new Date(t + dur) });
      }
    });

    // Geänderte Einzeltermine ohne zugehörige Serie
    if (!g.masters.length) {
      for (const [t, o] of overrides) single(`${uid}#${new Date(t).toISOString()}`, o);
    }
  }
  out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { calName, events: out };
}
