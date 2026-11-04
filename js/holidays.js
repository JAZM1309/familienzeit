// Gesetzliche Feiertage in Deutschland – lokal berechnet, ohne fremden Dienst.
// Bundesland aus den eigenen Einstellungen, sonst aus denen des Administrators.
import { state } from './app.js';

export const REGIONS = [
  ['', 'Nur bundesweite'], ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'],
  ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'], ['NI', 'Niedersachsen'],
  ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'],
  ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen'],
];

// Ostersonntag (gregorianisch, anonyme Formel)
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const cache = new Map();
export function holidaysOf(year, region = '') {
  const ck = year + region;
  if (cache.has(ck)) return cache.get(ck);
  const E = easter(year);
  const list = [
    [new Date(year, 0, 1), 'Neujahr'],
    [plus(E, -2), 'Karfreitag'],
    [plus(E, 1), 'Ostermontag'],
    [new Date(year, 4, 1), 'Tag der Arbeit'],
    [plus(E, 39), 'Christi Himmelfahrt'],
    [plus(E, 50), 'Pfingstmontag'],
    [new Date(year, 9, 3), 'Tag der Deutschen Einheit'],
    [new Date(year, 11, 25), '1. Weihnachtstag'],
    [new Date(year, 11, 26), '2. Weihnachtstag'],
  ];
  const r = (codes) => codes.split(' ').includes(region);
  if (r('BW BY ST')) list.push([new Date(year, 0, 6), 'Heilige Drei Könige']);
  if (r('BE') || (r('MV') && year >= 2023)) list.push([new Date(year, 2, 8), 'Internationaler Frauentag']);
  if (r('BB')) list.push([E, 'Ostersonntag'], [plus(E, 49), 'Pfingstsonntag']);
  if (r('BW BY HE NW RP SL')) list.push([plus(E, 60), 'Fronleichnam']);
  if (r('SL')) list.push([new Date(year, 7, 15), 'Mariä Himmelfahrt']);
  if (r('TH') && year >= 2019) list.push([new Date(year, 8, 20), 'Weltkindertag']);
  if (r('BB MV SN ST TH') || (r('HB HH NI SH') && year >= 2018)) list.push([new Date(year, 9, 31), 'Reformationstag']);
  if (r('BW BY NW RP SL')) list.push([new Date(year, 10, 1), 'Allerheiligen']);
  if (r('SN')) { // Mittwoch vor dem 23. November
    const d = new Date(year, 10, 22);
    while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
    list.push([d, 'Buß- und Bettag']);
  }
  const map = new Map(list.map(([d, n]) => [key(d), n]));
  cache.set(ck, map);
  return map;
}

export function myRegion() {
  const own = state.me?.settings?.region;
  if (own !== undefined && own !== null) return own;
  const admin = state.members?.find((m) => m.user_id === state.family?.admin_id);
  return admin?.settings?.region || '';
}

export function holidayName(d, region = myRegion()) {
  return holidaysOf(d.getFullYear(), region).get(key(d)) || null;
}
