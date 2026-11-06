// Version 2.3.0: Widgets und Kalender-Abo
// Ein persönlicher Link liefert die eigenen Termine (gleiche Sichtbarkeit wie in der App)
// als abonnierbaren Kalender (.ics) und als Daten für Startbildschirm-Widgets.
import { h, icon, toast, busy, confirmDialog, fold } from '../dom.js';
import * as api from '../api.js';
import { state, go, render } from '../app.js';
import { fmtDateTime } from '../dates.js';

const KEY = 'fz-widget';
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function loadLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && v.user === state.me.user_id ? v.token : null;
  } catch { return null; }
}
function saveLocal(token) {
  try { if (token) localStorage.setItem(KEY, JSON.stringify({ user: state.me.user_id, token })); else localStorage.removeItem(KEY); } catch { /* egal */ }
}

const baseUrl = (token) => `${api.SUPABASE_URL}/functions/v1/kalender?t=${token}`;
const icsUrl = (token) => baseUrl(token) + '&f=ics';
const webcalUrl = (token) => icsUrl(token).replace(/^https:/, 'webcal:');
const appUrl = () => location.origin + location.pathname;

async function copy(textValue, done = 'Kopiert.') {
  try { await navigator.clipboard.writeText(textValue); toast(done); }
  catch { window.prompt('Zum Kopieren gedrückt halten:', textValue); }
}

function steps(...items) {
  return h('ol', { class: 'small', style: { margin: '0 0 12px', paddingLeft: '20px', lineHeight: '1.55' } }, items.map((i) => h('li', null, i)));
}

function linkBox(value) {
  return h('div', {
    class: 'muted small',
    style: { wordBreak: 'break-all', background: 'var(--sky)', borderRadius: '10px', padding: '8px 10px', margin: '0 0 10px', fontFamily: 'ui-monospace, monospace', fontSize: '.75rem' },
  }, value);
}

export async function widgetView() {
  let info = null;
  try { info = await api.widgetTokenInfo(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  let token = info ? loadLocal() : null;
  if (!info) saveLocal(null);

  const root = h('div');

  const create = async (btn, renew) => {
    if (renew && !(await confirmDialog({
      title: 'Neuen Link erzeugen?',
      text: 'Der bisherige Link funktioniert dann nicht mehr. Kalender-Abos und Widgets, die ihn nutzen, musst du mit dem neuen Link neu einrichten.',
      ok: 'Neu erzeugen', danger: true,
    }))) return;
    busy(btn, true, 'Wird erzeugt …');
    try { saveLocal(await api.renewWidgetToken()); toast('Dein persönlicher Link ist bereit.'); render(); }
    catch (e) { toast(api.germanError(e), { type: 'error' }); busy(btn, false); }
  };

  const head = [
    h('div', { class: 'hello' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onClick: () => go('/kalender') }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { style: { fontSize: '1.35rem' } }, 'Widgets & Kalender-Abo'))),
    h('p', { class: 'muted small', style: { margin: '-8px 4px 14px' } },
      'Mit deinem persönlichen Link erscheinen die Familienzeit-Termine im Kalender deines Handys und als Widget auf dem Startbildschirm. Du siehst dort genau das, was du auch in der App siehst – nur lesend.'),
  ];

  // ---------- Noch kein Link (oder nicht auf diesem Gerät) ----------
  if (!info || !token) {
    const btn = h('button', { class: 'btn teal block' }, icon('link', 18), info ? 'Neuen Link erzeugen' : 'Persönlichen Link erzeugen');
    btn.addEventListener('click', () => create(btn, !!info));
    root.append(...head, h('section', { class: 'card', style: { textAlign: 'center' } },
      h('div', { class: 'card-icon', style: { margin: '4px auto 12px', width: '48px', height: '48px' } }, icon('calendar', 24)),
      info
        ? h('p', { style: { marginTop: 0 } }, `Du hast bereits einen Link (erstellt ${fmtDateTime(new Date(info.created_at))}${info.last_used_at ? ', zuletzt abgerufen ' + fmtDateTime(new Date(info.last_used_at)) : ''}). Aus Sicherheitsgründen wird er nur auf dem Gerät angezeigt, auf dem er erzeugt wurde.`)
        : h('p', { style: { marginTop: 0 } }, 'Erzeuge einmalig deinen persönlichen Link. Danach siehst du hier Schritt für Schritt, wie du Kalender und Widgets einrichtest.'),
      btn,
      info ? h('p', { class: 'muted small', style: { marginBottom: 0 } }, 'Ein neuer Link ersetzt den alten – bestehende Abos und Widgets musst du dann neu einrichten.') : null));
    return root;
  }

  // ---------- Kalender-Abo ----------
  const iphoneCal = h('div', null,
    h('a', { class: 'btn teal block', href: webcalUrl(token), style: { marginBottom: '12px' } }, icon('calendar', 18), 'Im iPhone-Kalender abonnieren'),
    steps('Auf den Knopf tippen und „Abonnieren“ bestätigen.',
      'Unter „Aktualisieren“ am besten „Alle 15 Minuten“ wählen und auf „Fertig“ tippen.',
      'Fertig: Die Termine stehen jetzt im Kalender – und damit auch im Kalender-Widget des iPhones (Startbildschirm lange drücken → „+“ → Kalender).'),
    h('p', { class: 'muted small', style: { margin: 0 } }, 'Klappt der Knopf nicht: Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen und den Link unten einfügen.'));

  const androidCal = h('div', null,
    steps(h('span', null, 'Die kostenlose App ', h('strong', null, 'ICSx⁵'), ' aus dem Play Store installieren.'),
      'Link unten kopieren, in ICSx⁵ auf „+“ tippen und einfügen. Name z. B. „Familienzeit“.',
      'In ICSx⁵ unter Einstellungen die Synchronisierung auf „Alle 15 Minuten“ stellen.',
      'Fertig: Die Termine erscheinen im Kalender des Handys (Google Kalender, Samsung Kalender …) und in dessen Widgets, z. B. Monatsansicht oder Terminliste.'),
    h('p', { class: 'muted small', style: { margin: 0 } }, 'Den Link besser nicht direkt im Google Kalender (Web) abonnieren – Google aktualisiert solche Abos oft nur alle 12 bis 24 Stunden.'));

  const icsLink = h('div', null,
    linkBox(icsUrl(token)),
    h('button', { class: 'btn ghost small', onClick: () => copy(icsUrl(token), 'Kalender-Link kopiert.') }, icon('copy', 16), 'Kalender-Link kopieren'));

  // ---------- Widget iPhone (Scriptable) ----------
  const scriptBtn = h('button', { class: 'btn teal block', style: { marginBottom: '12px' } }, icon('copy', 18), 'Widget-Skript kopieren');
  scriptBtn.addEventListener('click', async () => {
    busy(scriptBtn, true, 'Wird geladen …');
    try {
      const res = await fetch('js/widget-scriptable.txt', { cache: 'no-store' });
      if (!res.ok) throw new Error('fehlt');
      const code = (await res.text()).replace('__FZ_LINK__', baseUrl(token)).replace('__FZ_APP__', appUrl());
      await copy(code, 'Skript kopiert – jetzt in Scriptable einfügen.');
    } catch { toast('Das Skript konnte nicht geladen werden. Bitte Internet prüfen.', { type: 'error' }); }
    busy(scriptBtn, false);
  });
  const iphoneWidget = h('div', null,
    steps(h('span', null, 'Die kostenlose App ', h('strong', null, 'Scriptable'), ' aus dem App Store installieren.'),
      'Hier auf „Widget-Skript kopieren“ tippen.',
      'In Scriptable oben rechts auf „+“ tippen, ins leere Feld tippen und „Einsetzen“. Oben den Namen auf „Familienzeit“ ändern, dann „Fertig“.',
      'Startbildschirm lange drücken → „+“ → Scriptable → Größe wählen → hinzufügen.',
      'Das neue Widget lange drücken → „Widget bearbeiten“ → bei „Script“ Familienzeit wählen.'),
    scriptBtn,
    h('p', { class: 'muted small', style: { margin: 0 } },
      'Klein und mittel zeigen die nächsten Termine, groß den Monatskalender mit farbigen Punkten plus die nächsten Termine. ',
      'Unter „Parameter“ kannst du beim großen Widget „liste“ (nur Termine) oder „monat“ (nur Kalender) eintragen. ',
      'Auch als Sperrbildschirm-Widget nutzbar. Das Widget aktualisiert sich etwa alle 15 Minuten (iOS entscheidet den genauen Zeitpunkt).'));

  // ---------- Widget Android (KWGT, optional) ----------
  const jsonUrl = baseUrl(token) + '&anzahl=5';
  const formula = `$wg("${jsonUrl}", json, ".next[0].line")$`;
  const androidWidget = h('div', null,
    h('p', { class: 'small', style: { marginTop: 0 } },
      'Am einfachsten nimmst du das Kalender-Abo oben mit ICSx⁵ – dann funktionieren alle Kalender-Widgets deines Handys. Für ein eigenes Design geht es mit der App KWGT:'),
    steps('KWGT installieren, ein leeres Widget anlegen und ein Textfeld hinzufügen.',
      'Als Text die Formel unten einfügen. Für den zweiten Termin „next[1]“ statt „next[0]“ verwenden, für die Farbe „.next[0].colors[0]“.'),
    linkBox(formula),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost small', onClick: () => copy(formula, 'Formel kopiert.') }, icon('copy', 16), 'Formel kopieren'),
      h('button', { class: 'btn ghost small', onClick: () => copy(jsonUrl, 'Daten-Link kopiert.') }, icon('link', 16), 'Daten-Link kopieren')));

  // ---------- Link verwalten ----------
  const renewBtn = h('button', { class: 'btn ghost small' }, icon('repeat', 16), 'Neuen Link erzeugen');
  renewBtn.addEventListener('click', () => create(renewBtn, true));
  const manage = h('section', { class: 'card' },
    h('p', { class: 'small', style: { marginTop: 0 } },
      `Erstellt ${fmtDateTime(new Date(info.created_at))}`,
      info.last_used_at ? ` · zuletzt abgerufen ${fmtDateTime(new Date(info.last_used_at))}` : ' · noch nicht abgerufen'),
    h('p', { class: 'muted small' },
      'Wer diesen Link kennt, kann deine Termine lesen. Gib ihn nicht weiter. Falls er in falsche Hände geraten ist: neuen Link erzeugen – der alte funktioniert dann sofort nicht mehr.'),
    h('div', { class: 'btn-row' },
      renewBtn,
      h('button', {
        class: 'btn danger small',
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Link abschalten?', text: 'Kalender-Abos und Widgets mit diesem Link zeigen danach keine neuen Termine mehr.', ok: 'Abschalten', danger: true }))) return;
          try { await api.deleteWidgetToken(); saveLocal(null); toast('Link abgeschaltet.'); render(); }
          catch (e) { toast(api.germanError(e), { type: 'error' }); }
        },
      }, icon('trash', 16), 'Abschalten')));

  const ios = isIOS();
  const sec = (key, title, ic, summary, body, open = false) => fold({ group: 'widget', key, title, icon: ic, summary, body: h('section', { class: 'card' }, body), defaultOpen: open });
  const calSections = [
    sec('cal-ios', 'iPhone-Kalender', 'calendar', 'Ganzer Kalender, alle Ansichten', iphoneCal, ios),
    sec('cal-android', 'Android-Kalender', 'calendar', 'Mit ICSx⁵', androidCal, !ios),
  ];
  const widgetSections = [
    sec('w-ios', 'Widget am iPhone', 'home', 'Mit Scriptable', iphoneWidget),
    sec('w-android', 'Widget am Android', 'home', 'Mit KWGT (optional)', androidWidget),
  ];

  root.append(...head,
    h('div', { class: 'section-title' }, 'Familienkalender im Handy'),
    ...(ios ? calSections : calSections.reverse()),
    sec('cal-link', 'Kalender-Link', 'link', 'Für andere Kalender-Apps', icsLink),
    h('div', { class: 'section-title' }, 'Nächste Termine als Widget'),
    ...(ios ? widgetSections : widgetSections.reverse()),
    h('div', { class: 'section-title' }, 'Dein Link'),
    manage);
  return root;
}
