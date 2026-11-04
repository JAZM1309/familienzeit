// Oberfläche für den Kalender-Export (.ics): mehrere Termine oder ein einzelner Termin
import { h, icon, sheet, toast, busy } from './dom.js';
import * as api from './api.js';
import { state } from './app.js';
import { buildICS, icsFileName } from './ics-export.js';
import { addDays, startOfDay, toDateInput } from './dates.js';
import { nameOf } from './events.js';

const canShareFiles = () => {
  try { return !!navigator.canShare?.({ files: [new File(['x'], 'x.ics', { type: 'text/calendar' })] }); } catch { return false; }
};

function save(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = h('a', { href: url, download: fileName });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function share(text, fileName, title) {
  try {
    await navigator.share({ files: [new File([text], fileName, { type: 'text/calendar' })], title });
    return true;
  } catch (e) {
    if (e?.name === 'AbortError') return false;
    save(text, fileName); // Teilen nicht möglich → als Datei speichern
    return true;
  }
}

function hints() {
  return h('div', { class: 'ics-hints muted small' },
    h('p', null, h('strong', null, 'iPhone: '), '„Datei speichern“ – danach „Alle hinzufügen“ antippen.'),
    h('p', null, h('strong', null, 'Android: '), '„Teilen …“ und den Kalender auswählen, oder die gespeicherte Datei öffnen.'),
    h('p', null, h('strong', null, 'Google Kalender am PC: '), 'calendar.google.com → Einstellungen → Importieren.'),
    h('p', null, h('strong', null, 'Outlook: '), 'Datei öffnen oder unter „Kalender hinzufügen → Aus Datei hochladen“.'),
    h('p', null, 'Die Datei ist eine Kopie: Spätere Änderungen in Familienzeit kommen dort nicht automatisch an.'));
}

function actions(getFile, title) {
  const row = h('div', { class: 'btn-row', style: { marginTop: '16px' } });
  const run = async (btn, how) => {
    busy(btn, true, 'Einen Moment …');
    try {
      const f = await getFile();
      if (!f) return;
      if (how === 'share') { if (await share(f.text, f.fileName, title)) toast('Kalenderdatei erstellt.'); }
      else { save(f.text, f.fileName); toast(`${f.fileName} gespeichert.`); }
    } catch (e) {
      toast(api.germanError(e), { type: 'error' });
    } finally { busy(btn, false); }
  };
  if (canShareFiles()) {
    const sh = h('button', { class: 'btn', style: { flex: 1 } }, icon('share', 18), 'Teilen …');
    sh.addEventListener('click', () => run(sh, 'share'));
    row.append(sh);
  }
  const dl = h('button', { class: canShareFiles() ? 'btn ghost' : 'btn', style: { flex: 1 } }, icon('download', 18), 'Datei speichern');
  dl.addEventListener('click', () => run(dl, 'save'));
  row.append(dl);
  return row;
}

// Einzelner Termin (bei Serien die ganze Serie)
export function shareEvent(ev) {
  const text = buildICS([ev], { name: ev.title, nameOf });
  sheet('In Kalender übernehmen', () => h('div', null,
    h('p', { style: { marginTop: 0 } }, ev.rrule
      ? `„${ev.title}“ wird als Serie mit allen Wiederholungen und Ausnahmen exportiert.`
      : `„${ev.title}“ wird als Kalenderdatei (.ics) exportiert.`),
    actions(async () => ({ text, fileName: icsFileName(ev.title) }), ev.title),
    hints()));
}

// Mehrere Termine
export function exportSheet() {
  const me = state.me.user_id;
  let scope = 'mine';
  let range = 'future';
  let withExternal = false;
  let cache = null; // { key, events }

  sheet('Termine exportieren', () => {
    const info = h('p', { class: 'ics-count', 'aria-live': 'polite' }, 'Zähle Termine …');
    const segBox = (options, value, onPick, label) => {
      const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      const draw = (v) => el.replaceChildren(...options.map(([k, l]) => h('button', {
        type: 'button', 'aria-pressed': String(k === v), onClick: () => { draw(k); onPick(k); update(); },
      }, l)));
      draw(value);
      return el;
    };
    const ext = h('input', { type: 'checkbox', onChange: (e) => { withExternal = e.target.checked; update(); } });

    const load = async () => {
      const from = range === 'all' ? new Date(2000, 0, 1) : range === 'year' ? addDays(startOfDay(new Date()), -365) : startOfDay(new Date());
      const key = range;
      if (cache?.key !== key) cache = { key, events: await api.eventsInRange(from, addDays(new Date(), 10 * 365)) };
      return cache.events
        .filter((e) => scope === 'all' || e.owner_id === me)
        .filter((e) => withExternal || (!e.feed_id && e.source !== 'ics'))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    };
    let seq = 0;
    const update = async () => {
      const my = ++seq;
      info.textContent = 'Zähle Termine …';
      try {
        const list = await load();
        if (my !== seq) return;
        const series = list.filter((e) => e.rrule).length;
        info.textContent = list.length
          ? `${list.length} ${list.length === 1 ? 'Termin' : 'Termine'}${series ? `, davon ${series} ${series === 1 ? 'Serie' : 'Serien'} mit allen Wiederholungen` : ''}.`
          : 'Keine passenden Termine.';
      } catch (e) {
        if (my === seq) info.textContent = api.germanError(e);
      }
    };
    update();

    const getFile = async () => {
      const list = await load();
      if (!list.length) { toast('Keine passenden Termine.'); return null; }
      const who = scope === 'mine' ? state.me.display_name : (state.family?.name || 'Familie');
      return {
        text: buildICS(list, { name: `Familienzeit – ${who}`, nameOf }),
        fileName: icsFileName(`familienzeit-${scope === 'mine' ? 'meine-termine' : 'familie'}-${toDateInput(new Date())}`),
      };
    };

    return h('div', null,
      h('div', { class: 'field' }, h('label', null, 'Welche Termine?'),
        segBox([['mine', 'Von mir angelegt'], ['all', 'Alle, die ich sehe']], scope, (v) => { scope = v; }, 'Welche Termine')),
      h('div', { class: 'field' }, h('label', null, 'Zeitraum'),
        segBox([['future', 'Ab heute'], ['year', 'Ab letztem Jahr'], ['all', 'Alle']], range, (v) => { range = v; }, 'Zeitraum')),
      h('label', { class: 'rs-check' }, ext, h('span', null,
        h('strong', null, 'Auch abonnierte und importierte Kalender'),
        h('span', { class: 'muted small' }, 'Sonst nur Termine, die in Familienzeit eingetragen wurden.'))),
      h('p', { class: 'muted small', style: { margin: '0 0 4px' } }, 'Persönliche Termine anderer sind nie dabei.'),
      info,
      actions(getFile, 'Familienzeit-Termine'),
      hints());
  });
}
