// Fällige Erinnerungen berechnen. Serien werden in deutscher Ortszeit aufgefaltet,
// genau wie in der App (gleiche Regeln wie app/js/recur.js).

export const TZ = 'Europe/Berlin';
const DAY = 86400000;
const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Echter Zeitpunkt → "Wanduhr" (UTC-Felder = Berliner Uhrzeit)
export function toWall(d) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

// "Wanduhr" → echter Zeitpunkt
export function fromWall(w) {
  let guess = new Date(w.getTime());
  for (let i = 0; i < 3; i++) {
    const diff = toWall(guess).getTime() - w.getTime();
    if (diff === 0) break;
    guess = new Date(guess.getTime() - diff);
  }
  return guess;
}

const dayStart = (w) => new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()));
const addDays = (w, n) => new Date(w.getTime() + n * DAY);
const atTime = (day, ref) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), ref.getUTCHours(), ref.getUTCMinutes()));
const code = (w) => CODES[(w.getUTCDay() + 6) % 7];
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);

function parseRule(r) {
  const p = Object.fromEntries(r.split(';').map((x) => x.split('=')));
  return { freq: p.FREQ, n: Math.max(1, Number(p.INTERVAL || 1)), byday: p.BYDAY ? p.BYDAY.split(',') : [] };
}

// Startzeitpunkte (Wanduhr) einer Serie im Bereich [fromW, toW)
function wallStarts(startW, rule, untilStr, fromW, toW) {
  const out = [];
  let stop = toW;
  if (untilStr) {
    const [y, m, d] = untilStr.split('-').map(Number);
    const u = new Date(Date.UTC(y, m - 1, d + 1));
    if (u < stop) stop = u;
  }
  const take = (w) => { if (w >= startW && w >= fromW && w < stop) out.push(w); };
  let guard = 0;
  if (rule.freq === 'DAILY') {
    const skip = daysBetween(startW, fromW) - 2;
    for (let k = skip > 0 ? Math.floor(skip / rule.n) * rule.n : 0; guard++ < 4000; k += rule.n) {
      const w = atTime(addDays(dayStart(startW), k), startW);
      if (w >= stop) break;
      take(w);
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byday.length ? rule.byday : [code(startW)];
    const offs = CODES.map((c, i) => (days.includes(c) ? i : -1)).filter((i) => i >= 0);
    const week0 = addDays(dayStart(startW), -((startW.getUTCDay() + 6) % 7));
    const skipW = Math.floor((daysBetween(week0, fromW) - 2) / 7) - 1;
    outer: for (let w = skipW > 0 ? Math.floor(skipW / rule.n) * rule.n : 0; guard++ < 2000; w += rule.n) {
      for (const o of offs) {
        const x = atTime(addDays(week0, w * 7 + o), startW);
        if (x >= stop) break outer;
        take(x);
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let m = 0; guard++ < 1200; m += rule.n) {
      const x = new Date(Date.UTC(startW.getUTCFullYear(), startW.getUTCMonth() + m, startW.getUTCDate(), startW.getUTCHours(), startW.getUTCMinutes()));
      if (x >= stop) break;
      if (x.getUTCDate() === startW.getUTCDate()) take(x);
    }
  } else if (rule.freq === 'YEARLY') {
    for (let y = 0; guard++ < 200; y += rule.n) {
      const x = new Date(Date.UTC(startW.getUTCFullYear() + y, startW.getUTCMonth(), startW.getUTCDate(), startW.getUTCHours(), startW.getUTCMinutes()));
      if (x >= stop) break;
      if (x.getUTCMonth() === startW.getUTCMonth()) take(x);
    }
  }
  return out;
}

// Vorkommen mit Beginn in [from, to): { originalStart, start, title, location, allDay }
export function occurrencesStarting(ev, from, to) {
  const start = new Date(ev.starts_at);
  if (!ev.rrule) {
    return start >= from && start < to
      ? [{ originalStart: start, start, title: ev.title, location: ev.location, allDay: ev.all_day }]
      : [];
  }
  const exc = new Map((ev.exceptions || []).map((x) => [new Date(x.original_start).getTime(), x]));
  // etwas weiter zurück suchen, falls ein Einzeltermin nach hinten verschoben wurde
  const walls = wallStarts(toWall(start), parseRule(ev.rrule), ev.until, toWall(new Date(from.getTime() - 7 * DAY)), toWall(to));
  const out = [];
  for (const w of walls) {
    const orig = fromWall(w);
    const x = exc.get(orig.getTime());
    if (x?.cancelled) continue;
    const s = x?.starts_at ? new Date(x.starts_at) : orig;
    if (s < from || s >= to) continue;
    out.push({
      originalStart: orig, start: s,
      title: x?.title ?? ev.title,
      location: x?.location ?? ev.location,
      allDay: x?.all_day ?? ev.all_day,
    });
  }
  return out;
}

// Text der Erinnerung, z. B. "in 15 Min. · 18:00 · Sportplatz"
export function reminderBody(occ, now) {
  const fmt = (o) => new Intl.DateTimeFormat('de-DE', { timeZone: TZ, ...o }).format(occ.start);
  const dayDiff = daysBetween(toWall(now), toWall(occ.start));
  const dayWord = dayDiff === 0 ? 'Heute' : dayDiff === 1 ? 'Morgen' : fmt({ weekday: 'short', day: '2-digit', month: '2-digit' });
  let when;
  if (occ.allDay) when = `${dayWord} · ganztägig`;
  else {
    const mins = Math.round((occ.start - now) / 60000);
    const time = fmt({ hour: '2-digit', minute: '2-digit' });
    when = mins > 0 && mins < 60 ? `in ${mins} Min. · ${time}` : mins <= 0 ? `jetzt · ${time}` : `${dayWord} · ${time}`;
  }
  return occ.location ? `${when} · ${occ.location}` : when;
}

export function dayUrl(d) {
  const w = toWall(d);
  return `#/kalender?v=day&d=${w.toISOString().slice(0, 10)}`;
}

// Alle Erinnerungen, deren Zeitpunkt in (now - lookback, now] liegt
export function dueReminders(rows, now, lookbackMs = 15 * 60000) {
  const due = [];
  for (const r of rows) {
    const offsets = r.offsets || [];
    if (!offsets.length) continue;
    const maxOff = Math.max(...offsets) * 60000;
    const occs = occurrencesStarting(r, new Date(now.getTime() - lookbackMs), new Date(now.getTime() + maxOff + 60000));
    for (const occ of occs) {
      for (const off of offsets) {
        const fire = occ.start.getTime() - off * 60000;
        if (fire <= now.getTime() && fire > now.getTime() - lookbackMs) {
          due.push({
            event_id: r.id, user_id: r.user_id, occurrence: occ.originalStart, offset: off,
            title: `Erinnerung: ${occ.title}`, body: reminderBody(occ, now), url: dayUrl(occ.start),
          });
        }
      }
    }
  }
  return due;
}
