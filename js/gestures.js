// Wischgesten (nur Touch):
// - zur Seite wischen: Rubrik wechseln bzw. im Kalender blättern bzw. auf Unterseiten zurück
// - oben nach unten ziehen: Seite aktualisieren
// - Listeneinträge zur Seite wischen: z. B. abhaken oder löschen
// - Blatt (Dialog) nach unten wischen: schließen
import { h, icon } from './dom.js';

const KEY = 'fz-gestures';
export function gesturesEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setGesturesEnabled(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* egal */ }
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = () => { try { navigator.vibrate?.(8); } catch { /* egal */ } };

// Aktuelle Seiten-Aktionen { left, right } – von der App bei jedem Seitenwechsel gesetzt
let page = null;
export function setPageSwipe(handlers) { page = handlers; }

// Richtung, aus der die nächste Seite hereingleitet
let enter = null;
export function takeEnter() { const e = enter; enter = null; return e; }

// ---------- Listeneinträge ----------
// actions: { right: { label, icon, tone, run }, left: { ... } }
export function swipeable(row, actions) {
  const side = (a, dir) => (a ? h('div', { class: `swipe-bg ${dir}`, style: { background: a.tone } }, icon(a.icon, 20), h('span', null, a.label)) : null);
  const wrap = h('div', { class: 'swipe-wrap' }, side(actions.right, 'right'), side(actions.left, 'left'), row);
  row.classList.add('swipe-row');
  wrap.dataset.swipe = '1';
  wrap._swipe = { row, actions };
  return wrap;
}

function hScrollable(el, stop) {
  for (let n = el; n && n !== stop && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true;
  }
  return false;
}

let ptr; // Anzeige "Aktualisieren"
function ptrEl() {
  if (!ptr) {
    ptr = h('div', { class: 'ptr', 'aria-hidden': 'true' }, icon('repeat', 20));
    document.body.append(ptr);
  }
  return ptr;
}

export function initGestures({ refresh }) {
  let g = null;

  const reset = (el, animate = true) => {
    if (!el) return;
    el.style.transition = animate && !reduceMotion() ? 'transform .2s ease, opacity .2s ease' : 'none';
    el.style.transform = '';
    el.style.opacity = '';
    setTimeout(() => { el.style.transition = ''; }, 220);
  };

  document.addEventListener('touchstart', (e) => {
    g = null;
    if (!gesturesEnabled() || e.touches.length !== 1) return;
    const t = e.touches[0];
    const target = e.target;
    const sheetEl = target.closest('.sheet');
    if (document.querySelector('.overlay') && !sheetEl) return;
    if (document.querySelector('.lock-screen')) return;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]');
    let mode = 'page';
    let el = document.querySelector('main');
    if (sheetEl) { mode = 'sheet'; el = sheetEl; }
    else if (!typing && target.closest('[data-swipe]')) { mode = 'row'; el = target.closest('[data-swipe]'); }
    g = {
      mode, el, x0: t.clientX, y0: t.clientY, t0: Date.now(), dx: 0, dy: 0, axis: null,
      noX: !!typing || hScrollable(target, el) || mode === 'sheet',
      atTop: window.scrollY <= 0, sheetTop: sheetEl ? sheetEl.scrollTop <= 0 : false,
    };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0];
    g.dx = t.clientX - g.x0;
    g.dy = t.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(g.dx, g.dy) < 10) return;
      g.axis = Math.abs(g.dx) > Math.abs(g.dy) * 1.3 ? 'x' : 'y';
      if (g.axis === 'x' && g.noX) { g = null; return; }
    }
    if (g.axis === 'x') {
      e.preventDefault();
      if (g.mode === 'row') {
        const { row, actions } = g.el._swipe;
        const allowed = (g.dx > 0 && actions.right) || (g.dx < 0 && actions.left);
        row.style.transition = 'none';
        row.style.transform = `translateX(${allowed ? g.dx : g.dx * 0.15}px)`;
        g.el.classList.toggle('show-right', g.dx > 0);
        g.el.classList.toggle('show-left', g.dx < 0);
      } else if (g.mode === 'page' && g.el) {
        const can = (g.dx < 0 && page?.left) || (g.dx > 0 && page?.right);
        const d = can ? g.dx * 0.85 : g.dx * 0.18;
        g.el.style.transition = 'none';
        g.el.style.transform = `translateX(${d}px)`;
        g.el.style.opacity = String(1 - Math.min(0.4, Math.abs(d) / 900));
      }
    } else if (g.axis === 'y' && g.dy > 0) {
      if (g.mode === 'sheet' && g.sheetTop) {
        e.preventDefault();
        g.el.style.transition = 'none';
        g.el.style.transform = `translateY(${g.dy}px)`;
      } else if (g.mode !== 'sheet' && g.atTop && window.scrollY <= 0) {
        e.preventDefault();
        g.ptr = true;
        const p = ptrEl();
        const d = Math.min(110, g.dy * 0.5);
        p.style.transition = 'none';
        p.style.transform = `translate(-50%, ${d}px) rotate(${g.dy * 2}deg)`;
        p.style.opacity = String(Math.min(1, d / 60));
        p.classList.toggle('ready', d >= 60);
      }
    }
  }, { passive: false });

  const end = async () => {
    if (!g || !g.axis) { g = null; return; }
    const cur = g;
    g = null;
    const fast = Math.abs(cur.dx) / Math.max(1, Date.now() - cur.t0) > 0.5;

    if (cur.axis === 'x' && cur.mode === 'row') {
      const { row, actions } = cur.el._swipe;
      const a = cur.dx > 0 ? actions.right : actions.left;
      if (a && (Math.abs(cur.dx) > 90 || (fast && Math.abs(cur.dx) > 40))) {
        buzz();
        row.style.transition = 'transform .18s ease';
        row.style.transform = `translateX(${cur.dx > 0 ? '110%' : '-110%'})`;
        setTimeout(() => a.run(), 160);
      } else {
        reset(row);
        setTimeout(() => cur.el.classList.remove('show-right', 'show-left'), 200);
      }
      return;
    }

    if (cur.axis === 'x' && cur.mode === 'page' && cur.el) {
      const fn = cur.dx < 0 ? page?.left : page?.right;
      if (fn && (Math.abs(cur.dx) > 80 || (fast && Math.abs(cur.dx) > 40))) {
        buzz();
        enter = cur.dx < 0 ? 'right' : 'left';
        if (!reduceMotion()) {
          cur.el.style.transition = 'transform .15s ease, opacity .15s ease';
          cur.el.style.transform = `translateX(${cur.dx < 0 ? -40 : 40}%)`;
          cur.el.style.opacity = '0';
          await new Promise((r) => setTimeout(r, 140));
        }
        fn();
      } else reset(cur.el);
      return;
    }

    if (cur.axis === 'y' && cur.mode === 'sheet') {
      if (cur.sheetTop && cur.dy > 110) {
        cur.el.querySelector('button[aria-label="Schließen"]')?.click();
      } else reset(cur.el);
      return;
    }

    if (cur.axis === 'y' && cur.ptr && ptr) {
      const ready = ptr.classList.contains('ready');
      ptr.style.transition = 'transform .2s ease, opacity .2s ease';
      if (ready) {
        buzz();
        ptr.classList.add('spin');
        ptr.style.transform = 'translate(-50%, 60px)';
        try { await refresh(); } catch { /* egal */ }
      }
      ptr.classList.remove('spin', 'ready');
      ptr.style.transform = 'translate(-50%, 0)';
      ptr.style.opacity = '0';
    }
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', () => {
    if (g?.mode === 'page') reset(g.el);
    if (g?.mode === 'row') reset(g.el._swipe.row);
    if (g?.mode === 'sheet') reset(g.el);
    g = null;
  }, { passive: true });
}
