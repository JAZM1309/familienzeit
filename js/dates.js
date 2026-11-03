// Datums-Helfer. Gerechnet wird immer in der Ortszeit des Geräts.

const DAY = 86400000;

export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function addMonths(d, n) { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; }
export function startOfWeek(d) { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }
export function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x; }
export function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
export function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }

const pad = (n) => String(n).padStart(2, '0');
export function toDateInput(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function toTimeInput(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function fromDateInput(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function fromInputs(date, time) {
  const d = fromDateInput(date);
  if (time) { const [hh, mm] = time.split(':').map(Number); d.setHours(hh, mm, 0, 0); }
  return d;
}

const de = (opts) => new Intl.DateTimeFormat('de-DE', opts);
export const fmtTime = (d) => de({ hour: '2-digit', minute: '2-digit' }).format(d);
export const fmtDayLong = (d) => de({ weekday: 'long', day: 'numeric', month: 'long' }).format(d);
export const fmtDayShort = (d) => de({ weekday: 'short', day: 'numeric', month: 'short' }).format(d);
export const fmtDate = (d) => de({ day: 'numeric', month: 'long', year: 'numeric' }).format(d);
export const fmtDateTime = (d) => de({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
export const fmtMonth = (d) => de({ month: 'long', year: 'numeric' }).format(d);
export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// "Heute", "Morgen" oder Wochentag mit Datum
export function relativeDay(d, now = new Date()) {
  const diff = daysBetween(now, d);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  return fmtDayLong(d);
}
