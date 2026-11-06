// Widget-Daten: Serien auffalten, Farben und Texte fertig aufbereiten,
// damit Widgets (Scriptable, KWGT …) nichts mehr rechnen müssen.
import { TZ, toWall, fromWall, occurrencesStarting } from '../push/reminders.js';

const DAY = 86400000;
const FAMILY_COLOR = '#8496AE'; // wie in der App (js/events.js)
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pad = (n) => String(n).padStart(2, '0');

const wallDate = (d) => toWall(d).toISOString().slice(0, 10);
const wallTime = (d) => toWall(d).toISOString().slice(11, 16);
const wallMidnight = (d) => { const w = toWall(d); return fromWall(new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()))); };

function dayWord(day, today) {
  const diff = Math.round((Date.parse(day) - Date.parse(today)) / DAY);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  const d = new Date(day + 'T00:00:00Z');
  return `${WD[d.getUTCDay()]} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.`;
}

// Farben wie in der App: Kalenderfarbe > persönlich = Besitzer > Zugeordnete > Familie
function colorsFor(ev, members) {
  if (ev.color) return [ev.color];
  const byId = new Map(members.map((m) => [m.id, m]));
  if (ev.visibility === 'private') return [byId.get(ev.owner_id)?.color || FAMILY_COLOR];
  const cols = (ev.participants || []).map((id) => byId.get(id)?.color).filter(Boolean);
  return cols.length ? cols : [FAMILY_COLOR];
}

export function widgetJson(data, now, { days = 45, limit = 10 } = {}) {
  const today = wallDate(now);
  const t = toWall(now);
  const monthStart = fromWall(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)));
  const until = new Date(wallMidnight(now).getTime() + (days + 1) * DAY);
  const members = data.members || [];
  const names = new Map(members.map((m) => [m.id, m.name]));

  const items = [];
  for (const ev of data.events || []) {
    const dur = Math.max(0, new Date(ev.ends_at) - new Date(ev.starts_at));
    const exc = new Map((ev.exceptions || []).map((x) => [new Date(x.original_start).getTime(), x]));
    // etwas früher suchen, damit mehrtägige Termine, die schon laufen, mitkommen
    for (const o of occurrencesStarting(ev, new Date(monthStart.getTime() - 14 * DAY), until)) {
      const x = exc.get(o.originalStart.getTime());
      const start = o.start;
      const end = x?.ends_at ? new Date(x.ends_at) : new Date(start.getTime() + dur);
      if (end <= monthStart && start < monthStart) continue;
      const allDay = !!o.allDay;
      const day = wallDate(start);
      const endDay = end > start ? wallDate(new Date(end.getTime() - 1)) : day;
      const time = allDay ? '' : wallTime(start);
      const people = ev.visibility === 'private' ? [] : (ev.participants || []).map((id) => names.get(id)).filter(Boolean);
      let when = `${dayWord(day, today)} · ${allDay ? 'ganztägig' : time}`;
      if (endDay !== day) when = `${dayWord(day < today ? today : day, today)} · bis ${dayWord(endDay, today)}`;
      items.push({
        title: o.title,
        location: o.location || '',
        start: start.toISOString(),
        end: end.toISOString(),
        allDay, day, endDay, time,
        endTime: allDay ? '' : wallTime(end),
        colors: colorsFor(ev, members),
        people,
        private: ev.visibility === 'private',
        when,
        line: `${when} · ${o.title}`,
      });
    }
  }
  items.sort((a, b) => a.start.localeCompare(b.start) || (b.allDay - a.allDay) || a.title.localeCompare(b.title, 'de'));
  const next = items.filter((e) => new Date(e.end) > now || (e.allDay && e.endDay >= today)).slice(0, limit);

  return {
    family: data.family,
    me: data.me,
    members,
    timezone: TZ,
    today,
    updated: now.toISOString(),
    next,
    events: items,
  };
}
