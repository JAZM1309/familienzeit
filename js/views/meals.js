import { h, icon, avatar, sheet, toast, field, busy, confirmDialog } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, go, render } from '../app.js';
import { fmtDate } from '../dates.js';
import { nameOf } from '../events.js';
import { compressImage } from '../comments.js';

const me = () => state.me.user_id;
const likes = (m) => (m.meal_likes || []).map((l) => l.user_id);
const isFav = (m) => (m.meal_favorites || []).some((f) => f.user_id === me());
const memberById = (id) => state.members.find((x) => x.user_id === id);

async function imageUrls(meals) {
  const paths = meals.map((m) => m.image_path).filter(Boolean);
  try { return paths.length ? await api.signedUrls(paths) : {}; } catch { return {}; }
}
const imgOf = (m, urls) => (m.image_path ? urls[m.image_path] : m.image_url) || null;

function placeholder(m) {
  const owner = memberById(m.owner_id);
  return h('div', { class: 'meal-ph', style: { '--c': owner?.color || '#27A99A' } }, icon('meal', 34));
}

async function toggleMark(table, m, on, onDone) {
  try { await api.setMealMark(table, m.id, me(), on); onDone(); }
  catch (e) { toast(api.germanError(e), { type: 'error' }); }
}

function heartButton(m, onDone, big = false) {
  const liked = likes(m).includes(me());
  return h('button', {
    class: 'mark heart' + (liked ? ' on' : '') + (big ? ' big' : ''), 'aria-pressed': String(liked),
    'aria-label': liked ? 'Gefällt mir nicht mehr' : 'Gefällt mir',
    onClick: (e) => { e.stopPropagation(); toggleMark('meal_likes', m, !liked, onDone); },
  }, icon('heart', big ? 20 : 16), String(likes(m).length || ''));
}

function starButton(m, onDone, big = false) {
  const fav = isFav(m);
  return h('button', {
    class: 'mark star' + (fav ? ' on' : '') + (big ? ' big' : ''), 'aria-pressed': String(fav),
    'aria-label': fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten',
    onClick: (e) => { e.stopPropagation(); toggleMark('meal_favorites', m, !fav, onDone); },
  }, icon('star', big ? 20 : 16), big ? (fav ? 'Favorit' : 'Merken') : null);
}

export function mealCard(m, urls, onChange) {
  const url = imgOf(m, urls);
  const owner = memberById(m.owner_id);
  return h('div', { class: 'meal-card' + (m.cooked ? ' cooked' : '') },
    h('button', { class: 'meal-img', 'aria-label': m.title, onClick: () => go(`/gericht?id=${m.id}`) },
      url ? h('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : placeholder(m),
      m.cooked ? h('span', { class: 'meal-badge' }, icon('check', 12), 'Gekocht') : null),
    h('div', { class: 'meal-body' },
      h('button', { class: 'meal-title', onClick: () => go(`/gericht?id=${m.id}`) }, m.title),
      h('div', { class: 'meal-foot' },
        owner ? avatar(owner, 20, urlFor(owner)) : null,
        h('span', { class: 'grow' }),
        heartButton(m, onChange),
        starButton(m, onChange))));
}

// ---------- Liste ----------
let filter = 'alle';

export async function mealsView() {
  let meals = [];
  try { meals = await api.listMeals(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  const urls = await imageUrls(meals);
  const grid = h('div');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter' });

  const draw = () => {
    seg.replaceChildren(...[['alle', 'Alle'], ['meine', 'Meine'], ['favoriten', 'Favoriten'], ['gekocht', 'Gekocht']].map(([v, label]) =>
      h('button', { 'aria-pressed': String(v === filter), onClick: () => { filter = v; draw(); } }, label)));
    let list = [...meals];
    if (filter === 'meine') list = list.filter((m) => m.owner_id === me());
    if (filter === 'favoriten') list = list.filter(isFav);
    if (filter === 'gekocht') list = list.filter((m) => m.cooked).sort((a, b) => new Date(b.cooked_at) - new Date(a.cooked_at));
    else list.sort((a, b) => (a.cooked - b.cooked) || (likes(b).length - likes(a).length) || (new Date(b.created_at) - new Date(a.created_at)));
    const empty = { alle: 'Noch keine Essenswünsche. Was möchtest du gern mal essen?', meine: 'Du hast noch nichts gewünscht.',
      favoriten: 'Tippe bei einem Gericht auf den Stern, um es dir zu merken.', gekocht: 'Noch nichts als gekocht markiert.' }[filter];
    grid.replaceChildren(list.length
      ? h('div', { class: 'meal-grid' }, list.map((m) => mealCard(m, urls, render)))
      : h('div', { class: 'card', style: { textAlign: 'center' } }, h('p', { class: 'muted', style: { marginTop: 0 } }, empty),
        h('button', { class: 'btn teal small', onClick: () => go('/gericht-bearbeiten') }, icon('plus', 18), 'Wunsch hinzufügen')));
  };
  draw();

  return h('div', null,
    h('div', { class: 'hello' }, h('div', { class: 'grow' }, h('h1', null, 'Essenswünsche'))),
    seg, h('div', { style: { height: '12px' } }), grid,
    h('button', { class: 'fab', 'aria-label': 'Neuer Essenswunsch', onClick: () => go('/gericht-bearbeiten') }, icon('plus', 28)));
}

// ---------- Detail ----------
export async function mealView({ params }) {
  let m = null;
  try { m = await api.loadMeal(params.get('id')); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  if (!m) {
    return h('div', { class: 'center-state' }, h('div', null,
      h('p', null, 'Diesen Essenswunsch gibt es nicht mehr.'), h('button', { class: 'btn', onClick: () => go('/essen') }, 'Zu den Essenswünschen')));
  }
  const urls = await imageUrls([m]);
  const url = imgOf(m, urls);
  const own = m.owner_id === me();
  const likers = state.members.filter((x) => likes(m).includes(x.user_id));
  const ingredients = (m.ingredients || '').split('\n').map((x) => x.trim()).filter(Boolean);

  const cooked = h('button', {
    class: 'btn block' + (m.cooked ? ' ghost' : ' teal'),
    onClick: async () => {
      try { await api.setMealCooked(m.id, !m.cooked); toast(m.cooked ? 'Wieder auf der Wunschliste.' : 'Als gekocht markiert. Guten Appetit!'); render(); }
      catch (e) { toast(api.germanError(e), { type: 'error' }); }
    },
  }, icon(m.cooked ? 'repeat' : 'chef', 18), m.cooked ? 'Wieder wünschen' : 'Schon gekocht');

  const remove = async () => {
    if (!(await confirmDialog({ title: 'Essenswunsch löschen?', text: `„${m.title}“ wird für alle gelöscht.`, ok: 'Löschen', danger: true }))) return;
    try { await api.deleteMeal(m); toast('Gelöscht.'); go('/essen'); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  };

  return h('div', null,
    h('div', { class: 'hello' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onClick: () => go('/essen') }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { style: { fontSize: '1.35rem' } }, m.title))),
    h('div', { class: 'meal-hero' }, url ? h('img', { src: url, alt: m.title, referrerpolicy: 'no-referrer' }) : placeholder(m)),
    h('section', { class: 'card' },
      h('div', { class: 'meal-actions' }, heartButton(m, render, true), starButton(m, render, true)),
      likers.length ? h('p', { class: 'muted small', style: { margin: '10px 0 0' } },
        'Gefällt ', likers.map((x) => (x.user_id === me() ? 'dir' : x.display_name)).join(', ')) : null,
      m.cooked ? h('p', { class: 'small', style: { margin: '10px 0 0' } }, icon('check', 14), ` Gekocht von ${m.cooked_by === me() ? 'dir' : nameOf(m.cooked_by)} am ${fmtDate(new Date(m.cooked_at))}`) : null,
      h('div', { style: { marginTop: '14px' } }, cooked),
      m.description ? h('p', { class: 'pre', style: { marginBottom: 0 } }, m.description) : null),
    ingredients.length ? h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('cart', 19)), h('h2', null, 'Zutaten')),
      h('ul', { class: 'ingredients' }, ingredients.map((x) => h('li', null, x)))) : null,
    m.recipe || m.recipe_url ? h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('text', 19)), h('h2', null, 'Rezept')),
      m.recipe ? h('div', { class: 'pre' }, m.recipe) : null,
      m.recipe_url ? h('a', { class: 'btn ghost block', style: { marginTop: m.recipe ? '14px' : 0 }, href: m.recipe_url, target: '_blank', rel: 'noopener noreferrer' },
        icon('link', 18), 'Rezept öffnen') : null) : null,
    h('p', { class: 'muted small', style: { padding: '0 4px' } },
      `Gewünscht von ${own ? 'dir' : nameOf(m.owner_id)} am ${fmtDate(new Date(m.created_at))}`),
    own ? h('div', { class: 'btn-row', style: { marginBottom: '14px' } },
      h('button', { class: 'btn', style: { flex: 1 }, onClick: () => go(`/gericht-bearbeiten?id=${m.id}`) }, icon('edit', 18), 'Bearbeiten'),
      h('button', { class: 'btn danger', style: { flex: 1 }, onClick: remove }, icon('trash', 18), 'Löschen')) : null);
}

// ---------- Bearbeiten / Neu ----------
export async function mealEditView({ params }) {
  const id = params.get('id');
  let m = null;
  if (id) {
    try { m = await api.loadMeal(id); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
    if (!m || m.owner_id !== me()) {
      return h('div', { class: 'center-state' }, h('div', null,
        h('p', null, m ? 'Nur wer den Wunsch eingetragen hat, kann ihn bearbeiten.' : 'Diesen Essenswunsch gibt es nicht mehr.'),
        h('button', { class: 'btn', onClick: () => go('/essen') }, 'Zu den Essenswünschen')));
    }
  }
  const urls = m ? await imageUrls([m]) : {};

  const err = h('div', { class: 'error', role: 'alert', hidden: true });
  const showErr = (t) => { err.textContent = t; err.hidden = false; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const title = h('input', { class: 'input', value: m?.title || '', maxlength: 120, placeholder: 'z. B. Lasagne' });
  const description = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'Optional' });
  const ingredients = h('textarea', { class: 'input', rows: 5, maxlength: 4000, placeholder: 'Eine Zutat pro Zeile, z. B.\n500 g Nudeln\n2 Zwiebeln' });
  const recipe = h('textarea', { class: 'input', rows: 5, maxlength: 10000, placeholder: 'Optional' });
  const recipeUrl = h('input', { class: 'input', type: 'url', value: m?.recipe_url || '', maxlength: 1000, placeholder: 'https://…', inputmode: 'url' });
  description.value = m?.description || '';
  ingredients.value = m?.ingredients || '';
  recipe.value = m?.recipe || '';

  // Bild: neues Foto, Link oder entfernen
  let img = { kind: m?.image_path ? 'file' : m?.image_url ? 'link' : 'none', blob: null, link: m?.image_url || '', preview: imgOf(m || {}, urls) };
  const preview = h('div', { class: 'meal-hero small' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', 'aria-label': 'Foto auswählen' });
  const drawImg = () => {
    preview.replaceChildren(img.preview ? h('img', { src: img.preview, alt: '', referrerpolicy: 'no-referrer' }) : placeholder(m || { owner_id: me() }));
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const blob = await compressImage(f, 1200);
      if (img.preview?.startsWith('blob:')) URL.revokeObjectURL(img.preview);
      img = { kind: 'newfile', blob, link: '', preview: URL.createObjectURL(blob) };
      drawImg();
    } catch (e) { toast(e.message || 'Bild konnte nicht gelesen werden.', { type: 'error' }); }
  });
  const askLink = () => sheet('Bild über Link', (close) => {
    const input = h('input', { class: 'input', type: 'url', value: img.link, placeholder: 'https://…/bild.jpg', inputmode: 'url' });
    return h('form', {
      onSubmit: (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!/^https:\/\/\S+$/i.test(v)) { toast('Bitte einen Link beginnend mit https:// eingeben.', { type: 'error' }); return; }
        img = { kind: 'link', blob: null, link: v, preview: v };
        drawImg(); close();
      },
    }, h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Den Link eines Bildes aus dem Internet einfügen. Das Bild wird nicht kopiert, sondern direkt von dort angezeigt.'),
    input, h('button', { class: 'btn block', type: 'submit', style: { marginTop: '12px' } }, 'Übernehmen'));
  });
  drawImg();

  const save = h('button', { class: 'btn teal block', type: 'submit' }, 'Speichern');
  const onSubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!title.value.trim()) return showErr('Bitte einen Namen für das Gericht eingeben.');
    const link = recipeUrl.value.trim();
    if (link && !/^https?:\/\/\S+$/i.test(link)) return showErr('Der Rezeptlink muss mit http:// oder https:// beginnen.');
    const text = {
      title: title.value.trim(),
      description: description.value.trim() || null,
      ingredients: ingredients.value.trim() || null,
      recipe: recipe.value.trim() || null,
      recipe_url: link || null,
    };
    busy(save, true, 'Speichern …');
    try {
      const oldPath = m?.image_path || null;
      let mealId = m?.id;
      const imagePatch = img.kind === 'link' ? { image_url: img.link, image_path: null }
        : img.kind === 'none' ? { image_url: null, image_path: null } : {};
      if (!mealId) {
        mealId = await api.createMeal({ ...text, ...imagePatch, family_id: state.family.id, owner_id: me() });
      } else {
        await api.updateMeal(mealId, { ...text, ...imagePatch });
      }
      if (img.kind === 'newfile') {
        try {
          const path = await api.uploadMealImage(state.family.id, mealId, img.blob);
          await api.updateMeal(mealId, { image_path: path, image_url: null });
          if (oldPath) await api.removeFile(oldPath);
        } catch (ex) { toast('Gespeichert, aber das Foto konnte nicht hochgeladen werden.', { type: 'error' }); }
      } else if (oldPath && img.kind !== 'file') {
        await api.removeFile(oldPath);
      }
      toast(m ? 'Gespeichert.' : 'Essenswunsch eingetragen.');
      go(`/gericht?id=${mealId}`);
    } catch (ex) { showErr(api.germanError(ex)); busy(save, false); }
  };

  return h('div', null,
    h('div', { class: 'hello' },
      h('button', { class: 'iconbtn', 'aria-label': 'Abbrechen', onClick: () => go(m ? `/gericht?id=${m.id}` : '/essen') }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { style: { fontSize: '1.35rem' } }, m ? 'Wunsch bearbeiten' : 'Neuer Essenswunsch'))),
    h('form', { onSubmit, novalidate: true },
      err,
      h('section', { class: 'card' },
        field('Gericht', title),
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Beschreibung'), description)),
      h('section', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Bild'), preview),
        h('div', { class: 'btn-row' },
          h('label', { class: 'btn ghost small' }, icon('camera', 18), 'Foto', fileInput),
          h('button', { type: 'button', class: 'btn ghost small', onClick: askLink }, icon('link', 18), 'Link'),
          h('button', { type: 'button', class: 'btn ghost small', onClick: () => { img = { kind: 'none', blob: null, link: '', preview: null }; drawImg(); } }, 'Entfernen'))),
      h('section', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Zutaten (optional)'), ingredients),
        h('div', { class: 'field' }, h('label', null, 'Rezept (optional)'), recipe),
        field('Link zum Rezept (optional)', recipeUrl)),
      save));
}
