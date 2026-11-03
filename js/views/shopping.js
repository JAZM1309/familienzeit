import { h, icon, sheet, toast, field, confirmDialog } from '../dom.js';
import * as api from '../api.js';
import { state } from '../app.js';
import { CATEGORIES, CATEGORY_LABEL, parseItem, suggestCategory, itemLabel } from '../shopping-parse.js';
import { nameOf } from '../events.js';

const EMOJI = Object.fromEntries(CATEGORIES.map(([k, , e]) => [k, e]));
let stopWatching = null;

function loadShowDone() { try { return localStorage.getItem('fz-shop-done') === '1'; } catch { return false; } }
function saveShowDone(v) { try { localStorage.setItem('fz-shop-done', v ? '1' : '0'); } catch { /* egal */ } }

// Gelernte Kategorien: wie wurde ein Artikel früher eingeordnet?
function historyOf(items) {
  const map = {};
  for (const i of items) map[i.name.trim().toLowerCase()] = i.category;
  return map;
}

function chooseCategory(current, onPick) {
  sheet('Kategorie', (close) => h('div', { class: 'cat-grid' }, CATEGORIES.map(([k, label, e]) => h('button', {
    class: 'cat-btn', 'aria-pressed': String(k === current), onClick: () => { close(); onPick(k); },
  }, h('span', { class: 'cat-emoji' }, e), label))));
}

// Mehrere Artikel auf einmal hinzufügen (z. B. Zutaten eines Essenswunschs)
export async function addToShopping(lines) {
  let existing = [];
  try { existing = await api.listShopping(); } catch { /* egal */ }
  const hist = historyOf(existing);
  const rows = lines.map((l) => parseItem(l)).filter((p) => p.name).map((p) => ({
    ...p, category: suggestCategory(p.name, hist), family_id: state.family.id, added_by: state.me.user_id,
  }));
  if (rows.length) await api.addShopping(rows);
  return rows.length;
}

export async function shoppingView({ params }) {
  stopWatching?.();
  stopWatching = null;
  let items = [];
  try { items = await api.listShopping(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  let showDone = loadShowDone();
  const root = h('div');

  // ---------- Eingabe ----------
  let cat = 'sonstiges';
  let manualCat = false;
  const input = h('input', { class: 'input', placeholder: 'z. B. 2 Liter Milch', autocomplete: 'off', enterkeyhint: 'done', maxlength: 130, 'aria-label': 'Neuer Artikel' });
  const catBtn = h('button', { type: 'button', class: 'cat-chip', 'aria-label': 'Kategorie wählen' });
  const drawCat = () => catBtn.replaceChildren(h('span', null, EMOJI[cat]), h('span', { class: 'small' }, CATEGORY_LABEL[cat]), icon('down', 14));
  catBtn.addEventListener('click', () => chooseCategory(cat, (k) => { cat = k; manualCat = true; drawCat(); input.focus(); }));
  input.addEventListener('input', () => {
    if (!input.value.trim()) manualCat = false;
    if (!manualCat) { cat = suggestCategory(parseItem(input.value).name, historyOf(items)); drawCat(); }
  });
  drawCat();

  const form = h('form', {
    class: 'shop-add',
    onSubmit: async (e) => {
      e.preventDefault();
      const p = parseItem(input.value);
      if (!p.name) return;
      const row = { ...p, category: cat, family_id: state.family.id, added_by: state.me.user_id };
      input.value = ''; manualCat = false; cat = 'sonstiges'; drawCat();
      items.push({ ...row, id: 'tmp' + Date.now(), done: false, created_at: new Date().toISOString() });
      draw();
      try { await api.addShopping([row]); } catch (ex) { toast(api.germanError(ex), { type: 'error' }); }
      refresh();
      input.focus();
    },
  }, h('div', { class: 'shop-add-row' }, input, h('button', { class: 'btn teal', type: 'submit', 'aria-label': 'Hinzufügen' }, icon('plus', 22))), catBtn);

  // ---------- Liste ----------
  const list = h('div');
  const sub = h('p');
  const toggle = async (i) => {
    i.done = !i.done;
    draw();
    try { await api.updateShopping(i.id, { done: i.done }); } catch (e) { i.done = !i.done; draw(); toast(api.germanError(e), { type: 'error' }); }
  };

  const editItem = (i) => sheet('Artikel bearbeiten', (close) => {
    const name = h('input', { class: 'input', value: i.name, maxlength: 100 });
    const qty = h('input', { class: 'input', value: i.quantity || '', maxlength: 20, inputmode: 'decimal', placeholder: 'z. B. 2' });
    const unit = h('input', { class: 'input', value: i.unit || '', maxlength: 20, placeholder: 'z. B. Liter' });
    const sel = h('select', { class: 'input' }, CATEGORIES.map(([k, label, e]) => h('option', { value: k }, `${e} ${label}`)));
    sel.value = i.category;
    return h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        if (!name.value.trim()) return;
        try {
          await api.updateShopping(i.id, { name: name.value.trim(), quantity: qty.value.trim() || null, unit: unit.value.trim() || null, category: sel.value });
          close(); refresh();
        } catch (ex) { toast(api.germanError(ex), { type: 'error' }); }
      },
    },
    field('Artikel', name),
    h('div', { class: 'row2' }, field('Menge', qty), field('Einheit', unit)),
    h('div', { class: 'field' }, h('label', null, 'Kategorie'), sel),
    h('p', { class: 'muted small' }, `Hinzugefügt von ${i.added_by === state.me.user_id ? 'dir' : nameOf(i.added_by)}`),
    h('button', { class: 'btn block', type: 'submit' }, 'Speichern'),
    h('button', {
      type: 'button', class: 'btn danger block', style: { marginTop: '10px' },
      onClick: async () => { close(); try { await api.deleteShopping(i.id); refresh(); } catch (ex) { toast(api.germanError(ex), { type: 'error' }); } },
    }, icon('trash', 18), 'Entfernen'));
  });

  const row = (i) => h('div', { class: 'shop-item' + (i.done ? ' done' : '') },
    h('button', { class: 'task-check', 'aria-pressed': String(i.done), 'aria-label': i.done ? `${itemLabel(i)} wieder auf die Liste` : `${itemLabel(i)} abhaken`, onClick: () => toggle(i) },
      i.done ? icon('check', 16) : null),
    h('button', { class: 'shop-label', onClick: () => editItem(i) },
      h('span', null, i.quantity || i.unit ? h('strong', null, [i.quantity, i.unit].filter(Boolean).join(' ') + ' ') : null, i.name),
      i.added_by !== state.me.user_id ? h('span', { class: 'shop-by' }, nameOf(i.added_by)) : null));

  function draw() {
    const open = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done).sort((a, b) => new Date(b.done_at || 0) - new Date(a.done_at || 0));
    sub.textContent = open.length ? `${open.length} Artikel offen` : 'Alles erledigt';
    const groups = CATEGORIES.map(([k, label, e]) => [k, label, e, open.filter((i) => i.category === k)]).filter((g) => g[3].length);
    list.replaceChildren(
      ...(groups.length
        ? groups.map(([, label, e, rows]) => h('section', { class: 'card shop-group' },
          h('div', { class: 'shop-head' }, h('span', null, e), h('strong', null, label), h('span', { class: 'muted small' }, String(rows.length))),
          rows.map(row)))
        : [h('div', { class: 'card', style: { textAlign: 'center' } }, h('p', { class: 'muted', style: { margin: 0 } }, 'Die Einkaufsliste ist leer. 🎉'))]),
      done.length ? h('div', { class: 'shop-done-bar' },
        h('button', { class: 'link-btn', onClick: () => { showDone = !showDone; saveShowDone(showDone); draw(); } },
          showDone ? `Erledigte ausblenden (${done.length})` : `Erledigte anzeigen (${done.length})`),
        h('button', {
          class: 'link-btn danger-link',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Erledigte löschen?', text: `${done.length} abgehakte Artikel werden für alle entfernt.`, ok: 'Löschen', danger: true }))) return;
            try { await api.deleteDoneShopping(); refresh(); toast('Erledigte gelöscht.'); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
          },
        }, 'Erledigte löschen')) : null,
      done.length && showDone ? h('section', { class: 'card shop-group' }, done.map(row)) : null);
  }

  let pending = null;
  async function refresh() {
    if (!root.isConnected && stopWatching) { stopWatching(); stopWatching = null; return; }
    clearTimeout(pending);
    pending = setTimeout(async () => {
      try { items = await api.listShopping(); draw(); } catch { /* egal */ }
    }, 250);
  }

  draw();
  try { stopWatching = api.watchShopping(refresh); } catch { /* Live-Abgleich nicht verfügbar */ }
  document.addEventListener('visibilitychange', function onVis() {
    if (!root.isConnected) { document.removeEventListener('visibilitychange', onVis); return; }
    if (document.visibilityState === 'visible') refresh();
  });

  root.append(
    h('div', { class: 'hello' }, h('div', { class: 'grow' }, h('h1', null, 'Einkaufsliste'), sub)),
    h('section', { class: 'card' }, form),
    list);
  if (params.get('neu')) setTimeout(() => input.focus(), 50);
  return root;
}
