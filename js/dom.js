// Kleine DOM-Helfer. Alle Texte werden als Text eingesetzt, nie als HTML.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = true;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- Symbole (Linien-Icons, 24er-Raster) ----------
const ICONS = {
  home: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'c:9,7,4', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  user: ['c:12,8,4', 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  plus: ['M12 5v14M5 12h14'],
  calendar: ['r:3,4,18,18,2', 'M16 2v4M8 2v4M3 10h18'],
  tasks: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  cart: ['c:8,21,1', 'c:19,21,1', 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12'],
  meal: ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  share: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'M16 6l-4-4-4 4', 'M12 2v13'],
  copy: ['r:9,9,13,13,2', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  x: ['M18 6 6 18M6 6l12 12'],
  up: ['m18 15-6-6-6 6'],
  down: ['m6 9 6 6 6-6'],
  eye: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z', 'c:12,12,3'],
  eyeoff: ['M3 3l18 18', 'M10.6 5.1A10.5 10.5 0 0 1 12 5c7 0 10 7 10 7a17 17 0 0 1-2.3 3.4', 'M6.6 6.6A16.6 16.6 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z', 'c:12,13,3'],
  sliders: ['M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'],
  crown: ['M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z', 'M5 20h14'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  check: ['M20 6 9 17l-5-5'],
  back: ['M19 12H5', 'M12 19l-7-7 7-7'],
  info: ['c:12,12,10', 'M12 16v-4', 'M12 8h.01'],
  mail: ['r:2,4,20,16,2', 'm22 7-10 6L2 7'],
  smile: ['c:12,12,10', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01M15 9h.01'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  clock: ['c:12,12,10', 'M12 6v6l4 2'],
  lock: ['r:3,11,18,11,2', 'M7 11V7a5 5 0 0 1 10 0v4'],
  repeat: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  pin: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'c:12,10,3'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
  text: ['M17 6H3', 'M21 12H3', 'M15 18H3'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z'],
  star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  image: ['r:3,3,18,18,2', 'c:9,9,2', 'm21 15-5-5L5 21'],
  chef: ['M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6z', 'M6 17h12'],
};

const SVGNS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 22) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || []) {
    let el;
    if (d.startsWith('c:')) {
      const [cx, cy, r] = d.slice(2).split(',');
      el = document.createElementNS(SVGNS, 'circle');
      el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    } else if (d.startsWith('r:')) {
      const [x, y, w, hh, rx] = d.slice(2).split(',');
      el = document.createElementNS(SVGNS, 'rect');
      el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w);
      el.setAttribute('height', hh); el.setAttribute('rx', rx);
    } else {
      el = document.createElementNS(SVGNS, 'path');
      el.setAttribute('d', d);
    }
    svg.append(el);
  }
  return svg;
}

// ---------- Rückmeldungen ----------
let toastHost;
export function toast(message, { type, action, onAction, duration = 3500 } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: 'toast' + (type === 'error' ? ' error' : '') }, h('span', null, message));
  if (action) {
    t.append(h('button', { onClick: () => { t.remove(); onAction?.(); } }, action));
  }
  toastHost.append(t);
  if (duration) setTimeout(() => t.remove(), duration);
  return t;
}

// Unteres Blatt (Mobil) bzw. Dialog (Desktop)
export function sheet(title, build, onClose) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = h('div');
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'grab' }),
    h('div', { class: 'sheet-head' },
      h('h2', null, title),
      h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onClick: close }, icon('x'))),
    body);
  const overlay = h('div', { class: 'overlay', onClick: (e) => { if (e.target === overlay) close(); } }, panel);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  append(body, [build(close)]);
  panel.querySelector('input, button:not([aria-label="Schließen"])')?.focus({ preventScroll: true });
  return close;
}

// Sicherheitsabfrage
export function confirmDialog({ title, text, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    sheet(title, (closeIt) => h('div', null,
      h('p', { class: 'muted', style: { marginTop: 0 } }, text),
      h('div', { class: 'btn-row', style: { marginTop: '16px' } },
        h('button', { class: 'btn ghost', style: { flex: 1 }, onClick: closeIt }, 'Abbrechen'),
        h('button', { class: 'btn' + (danger ? ' danger' : ''), style: { flex: 1 }, onClick: () => { answer = true; closeIt(); } }, ok))),
    () => resolve(answer));
  });
}

// ---------- Formular-Bausteine ----------
export function field(label, input, hint) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function passwordInput(props = {}) {
  const input = h('input', { class: 'input', type: 'password', minlength: 8, required: true, ...props });
  const btn = h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Passwort anzeigen' }, icon('eye', 20));
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.replaceChildren(icon(show ? 'eyeoff' : 'eye', 20));
    btn.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
  });
  const wrap = h('div', { class: 'pw' }, input, btn);
  wrap.input = input;
  return wrap;
}

export function busy(button, on, label) {
  if (on) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.textContent = label || 'Bitte warten …';
  } else {
    button.disabled = false;
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

// ---------- Avatare ----------
function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function avatar(member, size = 44, url) {
  const color = member?.color || '#6B7A8F';
  const el = h('div', {
    class: 'avatar',
    style: { width: size + 'px', height: size + 'px', background: color, color: isLight(color) ? '#263445' : '#fff', fontSize: Math.round(size * 0.38) + 'px' },
    'aria-hidden': 'true',
  });
  if (url) el.append(h('img', { src: url, alt: '', loading: 'lazy' }));
  else if (member?.avatar) { el.style.fontSize = Math.round(size * 0.55) + 'px'; el.append(member.avatar); }
  else el.append(initials(member?.display_name));
  return el;
}

// Auswahl zwischen mehreren Möglichkeiten, z. B. "Nur dieser Termin" / "Ganze Serie"
export function choiceDialog({ title, text, choices }) {
  return new Promise((resolve) => {
    let answer = null;
    sheet(title, (close) => h('div', null,
      text ? h('p', { class: 'muted', style: { marginTop: 0 } }, text) : null,
      h('div', { style: { display: 'grid', gap: '10px', marginTop: '8px' } },
        choices.map((c) => h('button', {
          class: 'btn block' + (c.danger ? ' danger' : c.primary ? '' : ' ghost'),
          onClick: () => { answer = c.value; close(); },
        }, c.label)))),
    () => resolve(answer));
  });
}

export const ROLE_LABEL = { admin: 'Administrator', parent: 'Elternteil', child: 'Kind' };

// ---------- Klappbare Kacheln: pro Gruppe ist immer höchstens eine offen ----------
const foldKey = (group) => `fz-fold-${group}`;
function foldOpen(group, fallback) {
  try { const v = localStorage.getItem(foldKey(group)); return v === null ? fallback : v; } catch { return fallback; }
}
function foldRemember(group, key) {
  try { localStorage.setItem(foldKey(group), key); } catch { /* egal */ }
}

/**
 * fold({ group, key, title, icon, summary, body, defaultOpen })
 * body: Element, Liste von Elementen oder Funktion (wird erst beim ersten Öffnen gebaut)
 */
export function fold({ group, key, title, icon: ic, lead, summary = '', body, defaultOpen = false }) {
  let open = foldOpen(group, defaultOpen ? key : '') === key;
  let built = false;
  const sum = h('span', { class: 'fold-sum' }, summary);
  const chevron = h('span', { class: 'fold-chevron' }, icon('down', 20));
  const head = h('button', { class: 'fold-head', type: 'button', 'aria-expanded': String(open) },
    lead || (ic ? h('span', { class: 'card-icon' }, icon(ic, 19)) : null),
    h('span', { class: 'fold-title' }, h('span', { class: 'fold-name' }, title), sum),
    chevron);
  const content = h('div', { class: 'fold-body', hidden: !open });
  const card = h('section', { class: 'card fold' + (open ? ' open' : ''), 'data-fold-group': group, 'data-fold-key': key }, head, content);
  const build = () => {
    if (built) return;
    built = true;
    append(content, [typeof body === 'function' ? body() : body]);
  };
  const setOpen = (v) => {
    open = v;
    head.setAttribute('aria-expanded', String(v));
    content.hidden = !v;
    card.classList.toggle('open', v);
    if (v) build();
  };
  card._setOpen = setOpen;
  head.addEventListener('click', () => {
    if (open) { setOpen(false); foldRemember(group, ''); return; }
    for (const other of document.querySelectorAll(`[data-fold-group="${group}"]`)) if (other !== card) other._setOpen?.(false);
    setOpen(true);
    foldRemember(group, key);
    requestAnimationFrame(() => {
      const r = card.getBoundingClientRect();
      if (r.top < 64) window.scrollBy({ top: r.top - 72, behavior: 'smooth' });
    });
  });
  if (open) build();
  card.setSummary = (t) => { sum.textContent = t || ''; };
  return card;
}
