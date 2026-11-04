import { h, icon, avatar, sheet, toast, field, passwordInput, busy, confirmDialog, fold, ROLE_LABEL } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, render, applyUi, logout, isAdmin } from '../app.js';
import { updateCard } from '../updater.js';
import { notificationsCard } from '../push.js';
import { securityCard, defaultsCard } from '../settings.js';
import { backupCard } from '../backup.js';
import { restoreCard } from '../restore.js';
import { gesturesEnabled, setGesturesEnabled } from '../gestures.js';
import { APP_VERSION } from '../config.js';
import { REGIONS, myRegion } from '../holidays.js';
import { weatherPlace, searchPlaces } from '../weather.js';

const COLORS = ['#27A99A', '#E9A34A', '#5B7FDB', '#C9567A', '#8A63D2', '#3F9C4F', '#D9604C', '#2F8FB8', '#B08A2E', '#6B7A8F'];
// Vorgegebene Avatare, nach Gruppen
const AVATAR_GROUPS = [
  ['Tiere', ['🐻', '🦊', '🐼', '🐱', '🐶', '🦁', '🐸', '🐧', '🦄', '🐢', '🐰', '🐨', '🐯', '🦉', '🐙',
    '🐵', '🐷', '🐮', '🐹', '🐭', '🦒', '🦓', '🐘', '🦘', '🦥', '🦦', '🦔', '🐬', '🐳', '🦈',
    '🦜', '🦩', '🐝', '🦋', '🐞', '🦖', '🐲', '🐴', '🦝', '🐺']],
  ['Figuren', ['👩‍🚀', '🧑‍🚀', '🧙', '🧚', '🧜', '🦸', '🦹', '🥷', '🧛', '👸', '🤴', '🧑‍🎤', '🧑‍🍳', '🧑‍🔬', '🧑‍🎨',
    '🤖', '👽', '👻', '🎃', '⛄']],
  ['Sport & Hobby', ['⚽', '🏀', '🎾', '🏐', '⚾', '🏓', '🥋', '🛹', '🚴', '🏊', '🎸', '🎹', '🥁', '🎨', '🎮',
    '📚', '🧩', '🎯', '🚀', '🏰']],
  ['Eishockey & Winter', ['🏒', '🥅', '⛸️', '🏆', '🥇', '🧊', '❄️', '⛷️', '🏂', '🎿', '🛷', '🧤', '🧣', '☃️', '🏔️']],
  ['Natur & Essen', ['🌻', '🌈', '⭐', '🌙', '☀️', '🍀', '🌵', '🍄', '🌊', '🔥',
    '🍓', '🍉', '🍕', '🍩', '🧁']],
];
const EMOJIS = AVATAR_GROUPS.flatMap(([, list]) => list);

async function saveMe(patch, okText) {
  try {
    await api.updateMe(state.me.user_id, patch);
    Object.assign(state.me, patch);
    if (okText) toast(okText);
    return true;
  } catch (e) {
    toast(api.germanError(e), { type: 'error' });
    return false;
  }
}

// Bild auf 512 × 512 zuschneiden und komprimieren
async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const size = Math.min(512, side);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
    let blob = await toBlob('image/webp', 0.85);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function avatarCard() {
  const me = state.me;
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', 'aria-label': 'Foto auswählen' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    toast('Foto wird hochgeladen …');
    try {
      const blob = await shrinkImage(file);
      const path = await api.uploadAvatar(state.family.id, me.user_id, blob);
      const ok = await saveMe({ avatar_path: path, avatar: null });
      if (ok) {
        state.urls = { ...state.urls, ...(await api.signedUrls([path])) };
        toast('Profilbild gespeichert.');
        render();
      }
    } catch (e) {
      toast(e.message?.startsWith('Bild') ? e.message : api.germanError(e), { type: 'error' });
    }
  });

  const current = me.avatar_path ? null : me.avatar;
  const chooseEmoji = () => sheet('Avatar wählen', (close) => h('div', { class: 'emoji-groups' }, AVATAR_GROUPS.map(([label, list], gi) => fold({
    group: 'avatare', key: label, title: label,
    lead: h('span', { class: 'emoji-lead', 'aria-hidden': 'true' }, list.includes(current) ? current : list[0]),
    summary: `${list.length} Avatare` + (list.includes(current) ? ' · dein Avatar' : ''),
    defaultOpen: current ? list.includes(current) : gi === 0,
    body: () => h('div', { class: 'emoji-grid' }, list.map((em) => h('button', {
      'aria-label': `Avatar ${em}`, 'aria-pressed': String(me.avatar === em && !me.avatar_path),
      onClick: async () => {
        close();
        const old = me.avatar_path;
        if (await saveMe({ avatar: em, avatar_path: null }, 'Avatar gespeichert.')) {
          if (old) api.removeAvatar(old).catch(() => {});
          render();
        }
      },
    }, em))),
  }))));

  const remove = async () => {
    const ok = await confirmDialog({ title: 'Bild entfernen?', text: 'Statt des Bildes werden deine Initialen angezeigt.', ok: 'Entfernen', danger: true });
    if (!ok) return;
    const old = me.avatar_path;
    if (await saveMe({ avatar: null, avatar_path: null }, 'Bild entfernt.')) {
      if (old) api.removeAvatar(old).catch(() => {});
      render();
    }
  };

  return h('section', { class: 'card', style: { textAlign: 'center' } },
    h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '14px' } },
      avatar(me, 104, urlFor(me))),
    h('div', { style: { fontWeight: 700, fontSize: '1.2rem' } }, me.display_name),
    h('div', { class: 'muted small', style: { marginBottom: '16px' } }, `${ROLE_LABEL[me.role]} · ${me.email}`),
    h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
      h('label', { class: 'btn ghost small', style: { position: 'relative' } }, icon('camera', 18), 'Foto', fileInput),
      h('button', { class: 'btn ghost small', onClick: chooseEmoji }, icon('smile', 18), 'Avatar'),
      (me.avatar || me.avatar_path) ? h('button', { class: 'btn ghost small', onClick: remove }, 'Entfernen') : null));
}

function nameCard() {
  const input = h('input', { class: 'input', value: state.me.display_name, maxlength: 40, required: true, autocomplete: 'given-name' });
  const save = h('button', { class: 'btn small', type: 'submit' }, 'Speichern');
  return h('section', { class: 'card' },
    h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v || v === state.me.display_name) return;
        busy(save, true);
        if (await saveMe({ display_name: v }, 'Name gespeichert.')) render();
        else busy(save, false);
      },
    },
    field('Anzeigename', input),
    save));
}

function colorCard() {
  const current = state.me.color.toUpperCase();
  const pick = async (c) => { if (await saveMe({ color: c.toUpperCase() }, 'Profilfarbe gespeichert.')) render(); };
  const custom = h('input', { type: 'color', value: current, 'aria-label': 'Eigene Farbe wählen' });
  custom.addEventListener('change', () => pick(custom.value));
  const isCustom = !COLORS.includes(current);

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Profilfarbe')),
    h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Zeigt im Kalender, welche Termine zu dir gehören.'),
    h('div', { class: 'swatches' },
      COLORS.map((c) => h('button', {
        class: 'swatch', style: { background: c }, 'aria-label': `Farbe ${c}`, 'aria-pressed': String(c === current),
        onClick: () => pick(c),
      }, c === current ? icon('check', 18) : null)),
      h('label', { class: 'swatch custom', 'aria-pressed': String(isCustom), title: 'Eigene Farbe' },
        isCustom ? icon('check', 18) : null, custom)));
}

function displayCard() {
  const settings = state.me.settings || {};
  const seg = (options, value, onPick) => h('div', { class: 'seg', role: 'group' },
    options.map(([v, label]) => h('button', { 'aria-pressed': String(v === value), onClick: () => onPick(v) }, label)));

  const update = async (patch) => {
    const next = { ...(state.me.settings || {}), ...patch };
    applyUi(next);
    if (await saveMe({ settings: next })) render();
  };

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Darstellung')),
    h('div', { class: 'field' }, h('label', null, 'Farbschema'),
      seg([['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']], settings.theme || 'auto', (v) => update({ theme: v }))),
    h('div', { class: 'field' }, h('label', null, 'Schriftgröße'),
      seg([['s', 'Klein'], ['m', 'Normal'], ['l', 'Groß']], settings.fontSize || 'm', (v) => update({ fontSize: v }))),
    h('div', { class: 'switch-row', style: { marginBottom: '2px' } }, h('span', null, 'Wischgesten'),
      h('label', { class: 'toggle' }, h('input', {
        type: 'checkbox', checked: gesturesEnabled(), 'aria-label': 'Wischgesten',
        onChange: (e) => { setGesturesEnabled(e.target.checked); toast(e.target.checked ? 'Wischgesten eingeschaltet.' : 'Wischgesten ausgeschaltet.'); },
      }), h('span'))),
    h('p', { class: 'hint', style: { margin: 0 } }, 'Zur Seite wischen wechselt die Rubrik, im Kalender wird geblättert. Nach unten ziehen aktualisiert. Gilt für dieses Gerät.'));
}

function passwordCard() {
  const open = () => sheet('Passwort ändern', (close) => {
    const err = h('div', { class: 'error', role: 'alert', hidden: true });
    const pw = passwordInput({ autocomplete: 'new-password' });
    const pw2 = passwordInput({ autocomplete: 'new-password' });
    const save = h('button', { class: 'btn block', type: 'submit' }, 'Passwort speichern');
    return h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        const show = (m) => { err.textContent = m; err.hidden = false; };
        if (pw.input.value.length < 8) return show('Das Passwort braucht mindestens 8 Zeichen.');
        if (pw.input.value !== pw2.input.value) return show('Die beiden Passwörter stimmen nicht überein.');
        busy(save, true);
        try { await api.changePassword(pw.input.value); close(); toast('Passwort geändert.'); }
        catch (ex) { show(api.germanError(ex)); busy(save, false); }
      },
    }, err, field('Neues Passwort', pw, 'Mindestens 8 Zeichen.'), field('Wiederholen', pw2), save);
  });

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Konto')),
    h('div', { style: { display: 'grid', gap: '10px' } },
      h('button', { class: 'btn ghost block', onClick: open }, 'Passwort ändern'),
      h('button', {
        class: 'btn danger block',
        onClick: async () => {
          const ok = await confirmDialog({ title: 'Abmelden?', text: 'Du kannst dich jederzeit mit E-Mail und Passwort wieder anmelden.', ok: 'Abmelden' });
          if (ok) logout();
        },
      }, icon('logout', 18), 'Abmelden')));
}

// Feiertage (Bundesland) und Wetter-Ort – ohne eigene Wahl gilt die des Administrators
function placeCard() {
  const card = h('section', { class: 'card' });
  const admin = state.members.find((m) => m.user_id === state.family?.admin_id);
  const iAmAdmin = admin?.user_id === state.me.user_id;
  const save = async (patch, text) => {
    const next = { ...(state.me.settings || {}), ...patch };
    if (await saveMe({ settings: next }, text)) { try { localStorage.removeItem('fz-weather'); } catch { /* egal */ } render(); }
  };
  const draw = () => {
    const own = state.me.settings || {};
    const sel = h('select', { class: 'input', 'aria-label': 'Bundesland für Feiertage' },
      ...(!iAmAdmin ? [h('option', { value: '__admin' }, `Wie die Familie (${(REGIONS.find(([k]) => k === (admin?.settings?.region || '')) || REGIONS[0])[1]})`)] : []),
      ...REGIONS.map(([k, l]) => h('option', { value: k }, l)));
    sel.value = own.region === undefined || own.region === null ? (iAmAdmin ? '' : '__admin') : own.region;
    sel.addEventListener('change', () => save({ region: sel.value === '__admin' ? null : sel.value }, 'Feiertage gespeichert.'));

    const place = weatherPlace();
    const ownWeather = own.weather;
    const placeText = place
      ? `${place.name}${ownWeather?.lat == null && !iAmAdmin ? ' (Ort der Familie)' : ''}`
      : ownWeather === null ? 'Ausgeschaltet' : 'Noch kein Ort gewählt';
    card.replaceChildren(...[
      h('div', { class: 'card-head' }, h('h3', null, 'Feiertage und Wetter')),
      h('div', { class: 'field' }, h('label', null, 'Feiertage im Kalender'), sel,
        h('div', { class: 'hint' }, iAmAdmin ? 'Gilt auch für alle, die nichts anderes wählen.' : 'Bundesweite Feiertage werden immer angezeigt.')),
      h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Wetter auf der Startseite'),
        h('div', { class: 'place-row' }, h('span', { class: 'place-name' }, placeText),
          h('button', { class: 'btn ghost small', onClick: () => pickPlace((p) => save({ weather: p }, `Wetter für ${p.name}.`)) }, place ? 'Ändern' : 'Ort wählen'),
          place || ownWeather ? h('button', { class: 'btn ghost small', onClick: () => save({ weather: null }, 'Wetter ausgeschaltet.') }, 'Aus') : null,
          ownWeather === null && !iAmAdmin && admin?.settings?.weather?.lat != null
            ? h('button', { class: 'btn ghost small', onClick: () => { const n = { ...own }; delete n.weather; saveMe({ settings: n }).then(draw); } }, 'Wie die Familie') : null),
        h('div', { class: 'hint' }, 'Die Wetterdaten kommen kostenlos von Open-Meteo. Übertragen wird nur der gewählte Ort, nicht dein Standort.')),
    ].filter(Boolean));
  };
  draw();
  return card;
}

function pickPlace(onPick) {
  sheet('Ort für das Wetter', (close) => {
    const input = h('input', { class: 'input', placeholder: 'z. B. Dortmund', autocomplete: 'off', enterkeyhint: 'search' });
    const results = h('div', { class: 'place-results' });
    const go = h('button', { class: 'btn', type: 'submit' }, icon('search', 18), 'Suchen');
    return h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (q.length < 2) return;
        busy(go, true, 'Suche …');
        try {
          const list = await searchPlaces(q);
          results.replaceChildren(...(list.length ? list.map((p) => h('button', {
            type: 'button', class: 'place-hit', onClick: () => { close(); onPick(p); },
          }, h('strong', null, p.name), h('span', { class: 'muted small' }, p.region))) : [h('p', { class: 'muted' }, 'Kein Ort gefunden.')]));
        } catch { results.replaceChildren(h('p', { class: 'error' }, 'Die Suche hat nicht geklappt. Bitte später noch einmal.')); }
        busy(go, false);
      },
    }, h('div', { class: 'place-search' }, input, go), results);
  });
}

export async function profileView() {
  const settings = state.me.settings || {};
  const themeText = { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' }[settings.theme || 'auto'];
  const fontText = { s: 'klein', m: 'normal', l: 'groß' }[settings.fontSize || 'm'];
  const f = (key, title, ic, body, summary) => fold({ group: 'profil', key, title, icon: ic, body, summary });
  return h('div', null,
    h('div', { class: 'hello' }, h('div', { class: 'grow' }, h('h1', null, 'Mein Profil'))),
    avatarCard(),
    f('name', 'Name und Profilfarbe', 'user', () => h('div', { class: 'fold-stack' }, nameCard(), colorCard()), state.me.display_name),
    f('darstellung', 'Darstellung', 'sliders', displayCard, `${themeText} · Schrift ${fontText}`),
    f('meldungen', 'Benachrichtigungen', 'bell', notificationsCard),
    f('ort', 'Feiertage und Wetter', 'calendar', placeCard,
      [(REGIONS.find(([k]) => k === myRegion()) || REGIONS[0])[1].replace('Nur bundesweite', 'bundesweit'), weatherPlace()?.name].filter(Boolean).join(' · ')),
    f('erinnerungen', 'Standard-Erinnerungen', 'clock', defaultsCard),
    f('sicherheit', 'Sicherheit und Geräte', 'shield', securityCard),
    f('konto', 'Konto', 'lock', passwordCard, state.me.email),
    isAdmin() ? f('speicher', 'Speicher und Datensicherung', 'download', backupCard) : null,
    isAdmin() ? f('wiederherstellung', 'Wiederherstellung', 'repeat', restoreCard, 'Probelauf und Notfall') : null,
    isAdmin() ? f('update', 'App-Update', 'download', updateCard, `installiert: ${APP_VERSION}`) : null,
    h('p', { class: 'version' }, `Familienzeit ${APP_VERSION}`));
}
