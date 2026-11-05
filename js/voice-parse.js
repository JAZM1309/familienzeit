// Sprachbefehle verstehen: „Erstelle einen Termin am Freitag um 15 Uhr Zahnarzt für Mia“
// Läuft komplett auf dem Gerät. Es wird nichts an einen Dienst geschickt.

import { startOfDay, addDays } from './dates.js';

// Wortgrenze, die auch mit Umlauten funktioniert (ohne Lookbehind, damit ältere iPhones mitkommen)
const W = (p) => new RegExp(`(^|[^\\p{L}\\d])(?:${p})(?=$|[^\\p{L}\\d])`, 'iu');

// ---------- Zahlwörter ----------
const ONES = { ein: 1, eins: 1, eine: 1, einer: 1, einen: 1, einem: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const NUMS = { ...ONES, zehn: 10, elf: 11, 'zwölf': 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, 'dreißig': 30, vierzig: 40, 'fünfzig': 50 };
for (const [w, n] of Object.entries({ ein: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9 })) {
  NUMS[w + 'undzwanzig'] = 20 + n; NUMS[w + 'unddreißig'] = 30 + n; NUMS[w + 'undvierzig'] = 40 + n; NUMS[w + 'undfünfzig'] = 50 + n;
}
const NUM_RE = Object.keys(NUMS).sort((a, b) => b.length - a.length).join('|');

const ORD = { erste: 1, ersten: 1, zweite: 2, zweiten: 2, dritte: 3, dritten: 3, vierte: 4, vierten: 4, 'fünfte': 5, 'fünften': 5, sechste: 6, sechsten: 6, siebte: 7, siebten: 7, achte: 8, achten: 8, neunte: 9, neunten: 9, zehnte: 10, zehnten: 10, elfte: 11, elften: 11, 'zwölfte': 12, 'zwölften': 12 };
for (const [w, n] of Object.entries({ dreizehn: 13, vierzehn: 14, 'fünfzehn': 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, 'dreißig': 30 })) { ORD[w + 'ste'] = n; ORD[w + 'sten'] = n; }
for (const [w, n] of Object.entries({ ein: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9 })) { ORD[w + 'undzwanzigste'] = 20 + n; ORD[w + 'undzwanzigsten'] = 20 + n; }
ORD.einunddreißigste = 31; ORD.einunddreißigsten = 31;
const ORD_RE = Object.keys(ORD).sort((a, b) => b.length - a.length).join('|');

const UNIT_AFTER = 'uhr|stunden?|minuten?|tagen?|tage|wochen?|monaten?|monate|jahren?|liter|kilo|kg|gramm|g|packungen?|flaschen?|dosen?|becher|stück|gläser|glas|tüten?|bund|beutel|kästen|kasten|netze?|rollen?|päckchen|scheiben';

// Zahlwörter nur dort in Ziffern umwandeln, wo sie sicher eine Zahl sind („einen Termin“ bleibt stehen)
function digitize(s) {
  const n = (w) => String(NUMS[w.toLowerCase()]);
  s = s.replace(new RegExp(`(^|[^\\p{L}\\d])(${NUM_RE})(?=\\s+(?:${UNIT_AFTER})(?:$|[^\\p{L}]))`, 'giu'), (m, p, w) => p + n(w));
  s = s.replace(new RegExp(`(^|[^\\p{L}\\d])(um|ab|bis|von|gegen|halb|nach|vor|alle|in|dreiviertel)\\s+(${NUM_RE})(?=$|[^\\p{L}\\d])`, 'giu'), (m, p, a, w) => `${p}${a} ${n(w)}`);
  // „15 Uhr dreißig“
  s = s.replace(new RegExp(`(\\d{1,2})\\s*uhr\\s+(${NUM_RE})(?=$|[^\\p{L}\\d])`, 'giu'), (m, hh, w) => `${hh} uhr ${n(w)}`);
  return s;
}

const MONTHS = { januar: 1, 'jänner': 1, februar: 2, 'märz': 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
const MONTH_RE = Object.keys(MONTHS).join('|');
const WEEKDAYS = { montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6, sonntag: 0 };
const WD_RE = Object.keys(WEEKDAYS).join('|');
const WD_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const pad = (n) => String(n).padStart(2, '0');
const hm = (h, m) => `${pad(h)}:${pad(m)}`;

function nextWeekday(now, wd, strict) {
  let diff = (wd - now.getDay() + 7) % 7;
  if (diff === 0 && strict) diff = 7;
  return addDays(startOfDay(now), diff);
}

/**
 * Text → { type, title, date, time, endTime, duration, allDay, people, rrule, priority, items, notes }
 * members: [{ user_id, display_name }], meId: eigene user_id
 */
export function parseCommand(input, { now = new Date(), members = [], meId = null } = {}) {
  let s = ' ' + digitize(String(input || '').replace(/[„“"!?]/g, ' ').replace(/\s+/g, ' ').trim()) + ' ';
  const r = { type: null, title: '', date: null, time: null, endTime: null, duration: null, allDay: false, people: [], rrule: null, priority: 'normal', items: [], notes: [] };

  // Treffer herausnehmen, damit nur der Titel übrig bleibt
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    const res = fn ? fn(m) : true;
    if (res === false) return false;
    s = s.slice(0, m.index) + (m[1] ?? '') + ' ' + s.slice(m.index + m[0].length);
    return true;
  };
  const takeAll = (re, fn) => { let n = 0; while (n < 10 && take(re, fn)) n++; return n; };

  // ---------- Art des Eintrags ----------
  const low = s.toLowerCase();
  if (/einkaufsliste|einkaufszettel|auf die liste|zur liste|auf den zettel|einkaufen|einkauf/.test(low)) r.type = 'shopping';
  else if (/aufgabe|to-?do|erinnere mich|erinner mich|nicht vergessen/.test(low)) r.type = 'task';
  else if (/termin|kalender|eintragen|trag .* ein|trage .* ein|verabredung|treffen/.test(low)) r.type = 'event';
  else if (/(kaufen|besorgen|mitbringen|brauchen|ist alle|sind alle)\s*$/.test(low.trim()) || /^\s*(?:wir brauchen|ich brauche|es fehlt|es fehlen|wir haben kein)/.test(low)) r.type = 'shopping';

  if (r.type === 'shopping') { r.items = shoppingItems(s); return r; }

  // ---------- Wiederholung ----------
  take(W(`(?:jeden|jede|immer)\\s+(?:${WD_RE})(?:\\s*(?:,|und)\\s*(?:${WD_RE}))*|immer\\s+(?:${WD_RE})s(?:\\s*(?:,|und)\\s*(?:${WD_RE})s)*|(?:${WD_RE})s(?:\\s*(?:,|und)\\s*(?:${WD_RE})s)*`), (m) => {
    const days = [...m[0].toLowerCase().matchAll(new RegExp(`(${WD_RE})`, 'g'))].map((x) => WD_CODE[WEEKDAYS[x[1]]]);
    r.rrule = { freq: 'WEEKLY', interval: 1, byday: [...new Set(days)] };
  }) ||
  take(W('jeden tag|täglich|tagtäglich'), () => { r.rrule = { freq: 'DAILY', interval: 1, byday: [] }; }) ||
  take(W('alle (\\d+) wochen|alle 14 tage|vierzehntägig|zweiwöchentlich'), (m) => { r.rrule = { freq: 'WEEKLY', interval: Number(m[2]) || 2, byday: [] }; }) ||
  take(W('jede woche|wöchentlich|einmal (?:pro|die|in der) woche'), () => { r.rrule = { freq: 'WEEKLY', interval: 1, byday: [] }; }) ||
  take(W('jeden monat|monatlich|einmal (?:im|pro) monat'), () => { r.rrule = { freq: 'MONTHLY', interval: 1, byday: [] }; }) ||
  take(W('jedes jahr|jährlich|einmal (?:im|pro) jahr'), () => { r.rrule = { freq: 'YEARLY', interval: 1, byday: [] }; });

  // ---------- Tageszeit ----------
  let part = null; // 'am' | 'pm' | 'noon'
  take(W('(heute|morgen|übermorgen)\\s+(früh|morgen|vormittag|mittag|nachmittag|abend|nacht)'), (m) => {
    const d = { heute: 0, morgen: 1, 'übermorgen': 2 }[m[2].toLowerCase()];
    r.date = addDays(startOfDay(now), d);
    part = { 'früh': 'am', morgen: 'am', vormittag: 'am', mittag: 'noon', nachmittag: 'pm', abend: 'pm', nacht: 'pm' }[m[3].toLowerCase()];
  });
  take(W('(?:am\\s+)?(morgens|früh|vormittags|mittags|nachmittags|abends|nachts|am morgen|am vormittag|am mittag|am nachmittag|am abend)'), (m) => {
    const w = m[2].toLowerCase().replace('am ', '');
    part = { morgens: 'am', 'früh': 'am', vormittags: 'am', morgen: 'am', vormittag: 'am', mittags: 'noon', mittag: 'noon', nachmittags: 'pm', nachmittag: 'pm', abends: 'pm', abend: 'pm', nachts: 'pm' }[w];
  });

  // ---------- Uhrzeit ----------
  const T = '(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*uhr(?:\\s+(\\d{1,2}))?)?';
  const toTime = (h, m, m2) => {
    let hh = Number(h); const mm = Number(m || m2 || 0);
    if (hh > 23 || mm > 59) return null;
    return { hh, mm };
  };
  const adjust = ({ hh, mm }, explicit24) => {
    if (!explicit24 && hh <= 12) {
      if (part === 'pm' && hh < 12) hh += 12;
      else if (part === 'noon' && hh <= 3) hh += 12;
      else if (!part && hh >= 1 && hh <= 7) hh += 12; // „um 3“ meint in einer Familie fast immer 15 Uhr
    }
    if (part === 'am' && hh === 12) hh = 0;
    return hm(hh, mm);
  };
  const halfLike = (kind, h) => {
    let hh = Number(h);
    if (kind === 'halb') return { hh: hh - 1, mm: 30 };
    if (kind === 'viertel nach') return { hh, mm: 15 };
    if (kind === 'viertel vor' || kind === 'dreiviertel') return { hh: hh - 1, mm: 45 };
    if (kind === 'viertel') return { hh: hh - 1, mm: 15 }; // „viertel vier“ = 3:15
    return { hh, mm: 0 };
  };

  // Zeitraum „von 15 bis 17 Uhr“
  take(W(`(?:von\\s+|zwischen\\s+)?${T}\\s*(?:bis|-|–|und)\\s*${T}`), (m) => {
    if (!/uhr|:|\./i.test(m[0]) && !/von|zwischen/i.test(m[0])) return false;
    const a = toTime(m[2], m[3], m[4]); const b = toTime(m[5], m[6], m[7]);
    if (!a || !b) return false;
    r.time = adjust(a, a.hh > 12); r.endTime = adjust(b, b.hh > 12);
    if (r.endTime <= r.time && b.hh + 12 <= 23) r.endTime = hm(b.hh + 12, b.mm);
  });
  if (!r.time) {
    take(W('(?:um\\s+|gegen\\s+|ab\\s+)?(halb|viertel nach|viertel vor|dreiviertel|viertel)\\s+(\\d{1,2})(?:\\s*uhr)?'), (m) => {
      const t = halfLike(m[2].toLowerCase(), m[3]);
      if (t.hh < 0) t.hh += 24;
      r.time = adjust(t, false);
    }) ||
    take(W(`(?:um|gegen|ab)\\s+${T}`), (m) => {
      const t = toTime(m[2], m[3], m[4]); if (!t) return false;
      r.time = adjust(t, t.hh > 12 || !!m[3] && t.hh > 12);
    }) ||
    take(W(`(\\d{1,2})(?:[:.](\\d{2}))?\\s*uhr(?:\\s+(\\d{1,2}))?`), (m) => {
      const t = toTime(m[2], m[3], m[4]); if (!t) return false;
      r.time = adjust(t, t.hh > 12);
    }) ||
    take(W('(\\d{1,2}):(\\d{2})'), (m) => {
      const t = toTime(m[2], m[3]); if (!t) return false;
      r.time = adjust(t, t.hh > 12);
    }) ||
    take(W('mittags|zu mittag'), () => { r.time = '12:00'; });
    if (!r.time && part) r.time = { am: '09:00', noon: '12:00', pm: '19:00' }[part];
  }

  // Dauer
  take(W('(?:für\\s+)?(?:eine\\s+)?halbe\\s+stunde(?:\\s+lang)?'), () => { r.duration = 30; }) ||
  take(W('(?:für\\s+)?(\\d+)(?:[.,](\\d))?\\s*stunden?(?:\\s+lang)?'), (m) => { r.duration = Math.round((Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0)) * 60); }) ||
  take(W('(?:für\\s+)?(\\d+)\\s*minuten(?:\\s+lang)?'), (m) => { r.duration = Number(m[2]); });

  // ---------- Datum ----------
  const today = startOfDay(now);
  const fixYear = (d, explicit) => (!explicit && d < addDays(today, -1) ? new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()) : d);
  const valid = (y, mo, d) => { const x = new Date(y, mo - 1, d); return x.getMonth() === mo - 1 ? x : null; };

  if (!r.date) {
    take(W('(?:am\\s+|bis\\s+|zum\\s+|ab\\s+)?(\\d{1,2})\\.\\s?(\\d{1,2})\\.(?:\\s?(\\d{4}|\\d{2})(?![\\d:.]))?'), (m) => {
      let y = m[4] ? Number(m[4]) : now.getFullYear(); if (y < 100) y += 2000;
      const d = valid(y, Number(m[3]), Number(m[2])); if (!d) return false;
      r.date = fixYear(d, !!m[4]);
    }) ||
    take(W(`(?:am\\s+|bis\\s+|zum\\s+|ab\\s+)?(?:(\\d{1,2})\\.?|(${ORD_RE}))\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?`), (m) => {
      const day = m[2] ? Number(m[2]) : ORD[m[3].toLowerCase()];
      const y = m[5] ? Number(m[5]) : now.getFullYear();
      const d = valid(y, MONTHS[m[4].toLowerCase()], day); if (!d) return false;
      r.date = fixYear(d, !!m[5]);
    }) ||
    take(W('(?:bis\\s+|ab\\s+)?übermorgen'), () => { r.date = addDays(today, 2); }) ||
    take(W('(?:bis\\s+|ab\\s+)?morgen'), () => { r.date = addDays(today, 1); }) ||
    take(W('(?:bis\\s+|ab\\s+)?heute'), () => { r.date = today; }) ||
    take(W('in (\\d+) tagen'), (m) => { r.date = addDays(today, Number(m[2])); }) ||
    take(W('in (\\d+|einer) wochen?'), (m) => { r.date = addDays(today, 7 * (Number(m[2]) || 1)); }) ||
    take(W(`(?:am\\s+|bis\\s+|ab\\s+)?(nächsten|nächste|nächster|kommenden|kommende|kommender|diesen|diese|dieser|übernächsten)?\\s*(${WD_RE})`), (m) => {
      const q = (m[2] || '').toLowerCase();
      let d = nextWeekday(now, WEEKDAYS[m[3].toLowerCase()], q.startsWith('nächst'));
      if (q === 'übernächsten') d = addDays(nextWeekday(now, WEEKDAYS[m[3].toLowerCase()], true), 7);
      r.date = d;
    }) ||
    take(W('(?:am\\s+|übers?\\s+)?(?:nächsten\\s+|kommenden\\s+|dieses\\s+)?wochenende'), () => { r.date = nextWeekday(now, 6, false); }) ||
    take(W('übernächste woche'), () => { r.date = addDays(nextWeekday(now, 1, true), 7); }) ||
    take(W('(?:nächste|kommende) woche'), () => { r.date = nextWeekday(now, 1, true); }) ||
    take(W('(?:nächsten|kommenden) monat'), () => { r.date = new Date(now.getFullYear(), now.getMonth() + 1, 1); });
  }
  // Wochentag bei Wiederholung als Starttag nehmen
  if (!r.date && r.rrule?.byday?.length) {
    const first = r.rrule.byday.map((c) => nextWeekday(now, WD_CODE.indexOf(c), false)).sort((a, b) => a - b)[0];
    r.date = first;
  }

  if (/ganztägig|ganzen tag|den ganzen tag/i.test(s)) { r.allDay = true; take(W('(?:ganztägig|den ganzen tag|ganzen tag)')); }
  take(W('wichtig|dringend|hohe priorität|mit priorität'), () => { r.priority = 'high'; });

  // ---------- Personen ----------
  const people = new Set();
  const names = [];
  for (const mem of members) {
    const full = (mem.display_name || '').trim();
    if (!full) continue;
    const first = full.split(/\s+/)[0];
    for (const n of new Set([full, first])) names.push([n, mem.user_id]);
  }
  names.sort((a, b) => b[0].length - a[0].length);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameAlt = names.map(([n]) => esc(n) + 's?').join('|');
  const idOf = (txt) => {
    const t = txt.toLowerCase().replace(/s$/, '');
    if (['mich', 'ich', 'mir', 'mein', 'meine'].includes(txt.toLowerCase())) return meId;
    const hit = names.find(([n]) => n.toLowerCase() === txt.toLowerCase() || n.toLowerCase() === t);
    return hit?.[1] || null;
  };
  if (/für (?:die ganze familie|alle|uns alle|die familie)/i.test(s)) {
    take(W('für (?:die ganze familie|uns alle|alle|die familie)'));
  } else if (names.length || meId) {
    const who = `(?:${nameAlt ? nameAlt + '|' : ''}mich|ich)`;
    take(W(`(?:für|mit)\\s+${who}(?:\\s*(?:,|und)\\s*${who})*`), (m) => {
      const parts = m[0].replace(/^[^\p{L}]*(für|mit)\s+/iu, '').split(/\s*(?:,|\bund\b)\s*/);
      for (const p of parts) { const id = idOf(p.trim()); if (id) people.add(id); }
      if (/^[^\p{L}]*mit/iu.test(m[0])) return people.size ? false : false; // „mit Mia“ bleibt im Titel stehen
      return people.size > 0;
    });
    // auch ohne „für“: „Mias Zahnarzt“, „Training mit Mia“
    if (nameAlt) {
      for (const m of s.matchAll(new RegExp(`(^|[^\\p{L}\\d])(${nameAlt})(?=$|[^\\p{L}\\d])`, 'giu'))) {
        const id = idOf(m[2]); if (id) people.add(id);
      }
    }
  }
  r.people = [...people];

  // ---------- Titel ----------
  const FILLER = [
    'hey', 'hallo', 'bitte', 'kannst du( mir)?', 'könntest du', 'würdest du', 'ich möchte', 'ich will', 'ich hätte gern',
    'erstelle?', 'erstellen', 'lege?', 'anlegen', 'trage?', 'eintragen', 'füge?', 'hinzufügen', 'setze?', 'schreibe?', 'notiere?', 'mach(e)?', 'plane?', 'speichere?',
    'erinnere?( mich)?( daran)?', 'nicht vergessen',
    'neue[nrs]?', 'einen', 'eine', 'ein',
    'termin', 'aufgabe', 'to-?do', 'eintrag',
    'in (den|meinen|unseren) kalender', 'im kalender', 'in kalender', 'zum kalender', 'kalender',
    'mit dem titel', 'mit titel', 'namens', 'titel', 'betreff',
  ];
  let t = s;
  for (const f of FILLER) t = t.replace(new RegExp(`(^|[^\\p{L}\\d])(?:${f})(?=$|[^\\p{L}\\d])`, 'giu'), '$1 ');
  t = t.replace(/\s+/g, ' ').trim();
  // Übriggebliebene Bindewörter am Anfang und Ende
  const EDGE_START = /^(?:(?:und|am|um|an|ab|bis|zum|zur|beim|für|dass|daran|das|den|der|die|dem|ich|mich|wir|uns|,|\.|-|:)\s+)+/iu;
  const EDGE_END = /(?:\s+(?:und|am|um|an|ab|bis|zum|zur|für|ein|hinzu|auf|ein|eintragen|anlegen|erstellen|mit|von|vom|,|\.|-|:))+$/iu;
  for (let i = 0; i < 3; i++) t = t.replace(EDGE_START, '').replace(EDGE_END, '').replace(/^[,.:\-–\s]+|[,.:\-–\s]+$/g, '');
  if (/^(?:gehen|muss|müssen|soll|sollen)\s/i.test(t)) t = t.replace(/^\S+\s/, '');
  r.title = t ? t[0].toUpperCase() + t.slice(1) : '';

  // ---------- Standard-Art ----------
  if (!r.type) r.type = r.time || r.rrule || (r.date && !r.title.match(/(en)$/i)) ? 'event' : 'task';
  if (r.type === 'event' && !r.time && r.date) r.allDay = true;
  if (r.allDay) { r.time = null; r.endTime = null; }
  if (r.type === 'event' && !r.date) {
    if (r.time) {
      const [hh, mm] = r.time.split(':').map(Number);
      const at = new Date(today); at.setHours(hh, mm, 0, 0);
      r.date = at < now ? addDays(today, 1) : today;
    } else { r.date = today; r.notes.push('Kein Datum erkannt – bitte prüfen.'); }
  }
  if (r.type === 'event' && !r.time && !r.allDay) r.allDay = true;
  if (!r.title) r.notes.push('Kein Titel erkannt – bitte ergänzen.');
  return r;
}

// ---------- Einkaufsliste ----------
function shoppingItems(s) {
  let t = s;
  const STRIP = [
    'hey', 'bitte', 'noch', 'auch', 'kannst du', 'wir brauchen', 'ich brauche', 'brauchen', 'wir haben keine?n?', 'es fehlt', 'es fehlen',
    'setze?', 'schreibe?', 'füge?', 'packe?', 'trage?', 'notiere?', 'hinzufügen', 'hinzu', 'drauf', 'ein',
    'auf die einkaufsliste', 'auf den einkaufszettel', 'zur einkaufsliste', 'zum einkaufszettel', 'in die einkaufsliste', 'auf die liste', 'zur liste', 'auf den zettel',
    'einkaufsliste', 'einkaufszettel', 'beim einkaufen', 'einkaufen', 'einkauf', 'kaufen', 'besorgen', 'mitbringen', 'ist alle', 'sind alle',
  ];
  for (const f of STRIP) t = t.replace(new RegExp(`(^|[^\\p{L}\\d])(?:${f})(?=$|[^\\p{L}\\d])`, 'giu'), '$1 ');
  return t.split(/\s*(?:,|;|\bund\b|\bsowie\b|\bdazu\b)\s*/iu)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .map((x) => x.replace(/^(?:ein|eine|einen|etwas|paar|ein paar|die|der|das|den)\s+/iu, (m) => (/paar/i.test(m) ? '' : '')))
    .map((x) => x.replace(/^[.,:\-\s]+|[.,:\-\s]+$/g, ''))
    .filter((x) => x && !/^(?:und|auf|die|der|das|zu|zur)$/i.test(x))
    .map(capName);
}
// „2 liter milch“ → „2 Liter Milch“: Artikelname groß, Einheit wie gesprochen
const ITEM_RE = /^(\d+(?:[.,]\d+)?\s+)?((?:liter|kilo|kg|gramm|g|packungen?|flaschen?|dosen?|becher|stück|gläser|glas|tüten?|bund|beutel|kasten|kästen|netze?|rollen?|päckchen|scheiben)\s+)?(.*)$/iu;
function capName(x) {
  const m = x.match(ITEM_RE);
  const up = (w) => (w ? w[0].toUpperCase() + w.slice(1) : '');
  let unit = m[2] || '';
  if (/^(liter|kilo|gramm|packung|flasche|dose|becher|stück|gläser|glas|tüte|bund|beutel|kasten|kästen|netz|rolle|päckchen|scheiben)/i.test(unit)) unit = up(unit);
  return (m[1] || '') + unit + up(m[3]);
}
