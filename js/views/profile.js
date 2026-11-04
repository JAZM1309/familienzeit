import { h, icon, avatar, sheet, toast, field, passwordInput, busy, confirmDialog, ROLE_LABEL } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, render, applyUi, logout, isAdmin } from '../app.js';
import { updateCard } from '../updater.js';
import { notificationsCard } from '../push.js';
import { securityCard, defaultsCard } from '../settings.js';
import { backupCard } from '../backup.js';
import { APP_VERSION } from '../config.js';

const COLORS = ['#27A99A', '#E9A34A', '#5B7FDB', '#C9567A', '#8A63D2', '#3F9C4F', '#D9604C', '#2F8FB8', '#B08A2E', '#6B7A8F'];
const EMOJIS = ['🐻', '🦊', '🐼', '🐱', '🐶', '🦁', '🐸', '🐧', '🦄', '🐢', '🐰', '🐨', '🐯', '🦉', '🐙'];

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

  const chooseEmoji = () => sheet('Avatar wählen', (close) => h('div', { class: 'emoji-grid' },
    EMOJIS.map((em) => h('button', {
      'aria-label': `Avatar ${em}`, 'aria-pressed': String(me.avatar === em && !me.avatar_path),
      onClick: async () => {
        close();
        const old = me.avatar_path;
        if (await saveMe({ avatar: em, avatar_path: null }, 'Avatar gespeichert.')) {
          if (old) api.removeAvatar(old).catch(() => {});
          render();
        }
      },
    }, em))));

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
    h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Schriftgröße'),
      seg([['s', 'Klein'], ['m', 'Normal'], ['l', 'Groß']], settings.fontSize || 'm', (v) => update({ fontSize: v }))));
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

export async function profileView() {
  return h('div', null,
    h('div', { class: 'hello' }, h('div', { class: 'grow' }, h('h1', null, 'Mein Profil'))),
    avatarCard(),
    nameCard(),
    colorCard(),
    displayCard(),
    notificationsCard(),
    defaultsCard(),
    securityCard(),
    passwordCard(),
    isAdmin() ? backupCard() : null,
    isAdmin() ? updateCard() : null,
    h('p', { class: 'version' }, `Familienzeit ${APP_VERSION}`));
}
