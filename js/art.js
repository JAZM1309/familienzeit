// Kleine Illustrationen im Stil des Startbilds. Farben kommen aus CSS-Klassen,
// damit sie sich an die Rubrikfarbe und den Dunkelmodus anpassen:
// a = Rubrikfarbe, a2 = hell, a3 = mittel, k = Karte/Papier, l = Linien, o/r/g/y = Akzente
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}
const svg = (...kids) => s('svg', { viewBox: '0 0 160 120', class: 'art', 'aria-hidden': 'true' }, ...kids);
const ground = () => s('ellipse', { cx: 80, cy: 108, rx: 62, ry: 7, class: 'a2' });

const SCENES = {
  aufgaben: () => svg(ground(),
    s('rect', { x: 44, y: 16, width: 66, height: 88, rx: 10, class: 'a' }),
    s('rect', { x: 51, y: 25, width: 52, height: 72, rx: 6, class: 'k' }),
    s('rect', { x: 64, y: 10, width: 26, height: 14, rx: 5, class: 'a3' }),
    [38, 56, 74].map((y, i) => s('g', null,
      s('circle', { cx: 61, cy: y, r: 5.5, class: i < 2 ? 'a' : 'l-fill' }),
      i < 2 ? s('path', { d: `M58.2 ${y} l2 2.2 l3.8 -4`, class: 'tick' }) : null,
      s('rect', { x: 71, y: y - 3, width: i === 1 ? 20 : 26, height: 6, rx: 3, class: i < 2 ? 'l-done' : 'l-fill' }))),
    s('path', { d: 'M122 104 h16 l-2.5 -16 h-11z', class: 'o' }),
    s('path', { d: 'M130 88 c-2 -10 -10 -12 -12 -20 c8 1 12 7 12 14 c1 -9 6 -15 13 -16 c-1 9 -6 14 -13 22', class: 'g' })),

  essen: () => svg(ground(),
    s('path', { d: 'M62 30 q4 -8 0 -14 M80 28 q5 -9 0 -16 M98 30 q4 -8 0 -14', class: 'steam' }),
    s('rect', { x: 36, y: 44, width: 88, height: 10, rx: 5, class: 'a3' }),
    s('rect', { x: 74, y: 36, width: 12, height: 9, rx: 4, class: 'a' }),
    s('path', { d: 'M40 54 h80 v30 a20 20 0 0 1 -20 20 h-40 a20 20 0 0 1 -20 -20z', class: 'a' }),
    s('rect', { x: 26, y: 60, width: 16, height: 7, rx: 3.5, class: 'a3' }),
    s('rect', { x: 118, y: 60, width: 16, height: 7, rx: 3.5, class: 'a3' }),
    s('path', { d: 'M52 70 h56', class: 'shine' }),
    s('path', { d: 'M132 98 l12 -30 l5 2 l-12 30z', class: 'o' }),
    s('path', { d: 'M144 68 c-2 -6 2 -10 6 -10 c-1 4 -1 8 -6 10z M147 70 c4 -5 9 -4 11 -1 c-4 2 -7 3 -11 1z', class: 'g' })),

  einkauf: () => svg(ground(),
    s('rect', { x: 50, y: 18, width: 14, height: 46, rx: 7, class: 'y', transform: 'rotate(-18 57 41)' }),
    s('rect', { x: 84, y: 30, width: 22, height: 34, rx: 3, class: 'k-stroke' }),
    s('path', { d: 'M84 38 h22', class: 'l-line' }),
    s('circle', { cx: 74, cy: 54, r: 10, class: 'r' }),
    s('path', { d: 'M74 44 q2 -6 7 -7', class: 'stem' }),
    s('path', { d: 'M110 58 c-4 -14 4 -22 12 -24 c0 10 -4 18 -12 24z', class: 'g' }),
    s('path', { d: 'M30 60 h100 l-10 40 a6 6 0 0 1 -6 5 h-68 a6 6 0 0 1 -6 -5z', class: 'a' }),
    [48, 64, 80, 96, 112].map((x) => s('path', { d: `M${x} 68 l${x < 80 ? 2 : x > 80 ? -2 : 0} 28`, class: 'weave' })),
    s('rect', { x: 26, y: 56, width: 108, height: 10, rx: 5, class: 'a3' })),

  kalender: () => svg(ground(),
    s('rect', { x: 34, y: 20, width: 92, height: 84, rx: 12, class: 'k-stroke' }),
    s('path', { d: 'M34 32 a12 12 0 0 1 12 -12 h68 a12 12 0 0 1 12 12 v10 h-92z', class: 'a' }),
    s('rect', { x: 54, y: 12, width: 7, height: 18, rx: 3.5, class: 'a3' }),
    s('rect', { x: 99, y: 12, width: 7, height: 18, rx: 3.5, class: 'a3' }),
    [0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => s('rect', {
      x: 46 + c * 18, y: 52 + r * 16, width: 12, height: 10, rx: 3, class: r === 1 && c === 2 ? 'a' : 'l-fill',
    }))),
    s('circle', { cx: 132, cy: 30, r: 13, class: 'y' }),
    s('circle', { cx: 132, cy: 30, r: 19, class: 'y halo' })),

  fertig: () => svg(ground(),
    s('circle', { cx: 80, cy: 58, r: 38, class: 'a2' }),
    s('circle', { cx: 80, cy: 58, r: 27, class: 'a' }),
    s('path', { d: 'M67 58 l9 9 l17 -19', class: 'tick big' }),
    [[30, 30, 'o', 0], [126, 26, 'y', 30], [134, 78, 'r', 60], [26, 82, 'g', 15], [112, 100, 'a3', 45], [44, 104, 'y', 70]]
      .map(([x, y, c, rot]) => s('rect', { x, y, width: 9, height: 5, rx: 1.5, class: c, transform: `rotate(${rot} ${x + 4} ${y + 2})` })),
    s('circle', { cx: 118, cy: 50, r: 3, class: 'o' }), s('circle', { cx: 40, cy: 56, r: 2.5, class: 'a3' })),

  glocke: () => svg(ground(),
    s('path', { d: 'M80 22 a6 6 0 0 1 6 6 v2 c14 4 22 16 22 32 v18 l8 10 h-72 l8 -10 v-18 c0 -16 8 -28 22 -32 v-2 a6 6 0 0 1 6 -6z', class: 'a' }),
    s('circle', { cx: 80, cy: 98, r: 7, class: 'a3' }),
    s('path', { d: 'M62 52 q4 -10 14 -13', class: 'shine' }),
    s('text', { x: 114, y: 40, class: 'zz' }, 'z'), s('text', { x: 124, y: 28, class: 'zz small' }, 'z')),
};

export function art(name) {
  return (SCENES[name] || SCENES.kalender)();
}

// Kopfbereich einer Rubrik mit Titel, Untertitel und Illustration
export function banner({ title, subtitle, scene, action }) {
  return h('section', { class: 'banner' },
    h('div', { class: 'banner-text' },
      h('h1', null, title),
      subtitle instanceof Node ? (subtitle.classList.add('banner-sub'), subtitle) : subtitle ? h('p', { class: 'banner-sub' }, subtitle) : null,
      action || null),
    h('div', { class: 'banner-art' }, art(scene)));
}

// Leerer Zustand mit Illustration
export function emptyState({ scene, title, text, action, compact = false }) {
  return h('div', { class: 'empty' + (compact ? ' compact' : '') },
    h('div', { class: 'empty-art' }, art(scene)),
    title ? h('h3', null, title) : null,
    text ? h('p', null, text) : null,
    action || null);
}
