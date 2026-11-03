// Kommentare und Anhänge für Termine und Aufgaben
import { h, icon, avatar, toast, confirmDialog } from './dom.js';
import * as api from './api.js';
import { state, urlFor } from './app.js';
import { relTime } from './views/notifications.js';

const MAX_FILE = 5 * 1024 * 1024;
const userError = (m) => Object.assign(new Error(m), { user: true });

// Bild verkleinern (längste Seite 1600 px) und als WebP bzw. JPEG speichern
export async function compressImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(userError('Bild konnte nicht gelesen werden.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
    let blob = await toBlob('image/webp', 0.82);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.82);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function memberById(id) { return state.members.find((m) => m.user_id === id); }

// ---------- Kommentare ----------
export function commentsBlock(target) {
  const wrap = h('div', { class: 'comments' });
  const list = h('div', { class: 'comment-list' });
  const input = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'Kommentar schreiben …', 'aria-label': 'Kommentar' });
  const send = h('button', { class: 'iconbtn send', 'aria-label': 'Kommentar senden' }, icon('right', 22));

  const load = async () => {
    let rows = [];
    try { rows = await api.listComments(target); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
    list.replaceChildren(...(rows.length ? rows.map((c) => {
      const m = memberById(c.author_id);
      const mine = c.author_id === state.me.user_id;
      return h('div', { class: 'comment' },
        avatar(m || { display_name: '?' }, 32, urlFor(m)),
        h('div', { class: 'comment-main' },
          h('div', { class: 'comment-head' },
            h('strong', { style: { color: m?.color } }, mine ? 'Du' : (m?.display_name || 'Jemand')),
            h('span', { class: 'muted small' }, relTime(c.created_at)),
            mine ? h('button', {
              class: 'iconbtn tiny', 'aria-label': 'Kommentar löschen',
              onClick: async () => {
                if (!(await confirmDialog({ title: 'Kommentar löschen?', text: 'Der Kommentar wird für alle entfernt.', ok: 'Löschen', danger: true }))) return;
                try { await api.deleteComment(c.id); load(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
              },
            }, icon('trash', 15)) : null),
          h('div', { class: 'pre' }, c.body)));
    }) : [h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, 'Noch keine Kommentare.')]));
  };

  const submit = async () => {
    const body = input.value.trim();
    if (!body) return;
    send.disabled = true;
    try {
      await api.addComment(target, state.family.id, state.me.user_id, body);
      input.value = '';
      await load();
    } catch (e) { toast(api.germanError(e), { type: 'error' }); }
    send.disabled = false;
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); });

  wrap.append(list, h('div', { class: 'comment-input' }, input, send));
  load();
  return wrap;
}

// ---------- Anhänge ----------
export function attachmentsBlock(target, canEditTarget) {
  const grid = h('div', { class: 'att-grid' });
  const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'sr-only', 'aria-label': 'Foto oder PDF anhängen' });

  const load = async () => {
    let rows = [];
    try { rows = await api.listAttachments(target); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
    let urls = {};
    try { urls = await api.signedUrls(rows.map((r) => r.storage_path)); } catch { /* egal */ }
    const tiles = rows.map((a) => {
      const url = urls[a.storage_path];
      const isImg = a.mime.startsWith('image/');
      const canDelete = a.uploaded_by === state.me.user_id || canEditTarget;
      return h('div', { class: 'att' },
        h('a', { href: url || '#', target: '_blank', rel: 'noopener noreferrer', class: 'att-open', 'aria-label': a.file_name },
          isImg && url ? h('img', { src: url, alt: '', loading: 'lazy' }) : h('span', { class: 'att-pdf' }, icon('text', 26), h('span', null, a.file_name))),
        canDelete ? h('button', {
          class: 'att-del', 'aria-label': `${a.file_name} löschen`,
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Anhang löschen?', text: `„${a.file_name}“ wird für alle entfernt.`, ok: 'Löschen', danger: true }))) return;
            try { await api.deleteAttachment(a); load(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
          },
        }, icon('x', 14)) : null);
    });
    grid.replaceChildren(...tiles,
      h('label', { class: 'att add' }, icon('plus', 22), h('span', { class: 'small' }, 'Foto / PDF'), fileInput));
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      let blob = file;
      if (file.type.startsWith('image/')) blob = await compressImage(file);
      else if (file.type !== 'application/pdf') throw userError('Nur Fotos und PDF-Dateien sind möglich.');
      if (blob.size > MAX_FILE) throw userError('Die Datei ist größer als 5 MB.');
      toast('Wird hochgeladen …');
      const name = file.type.startsWith('image/') ? file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.jpg') : file.name;
      await api.uploadAttachment(target, state.family.id, state.me.user_id, blob, name);
      toast('Anhang gespeichert.');
      load();
    } catch (e) {
      toast(e.user ? e.message : api.germanError(e), { type: 'error', duration: 5000 });
    }
  });

  load();
  return grid;
}
