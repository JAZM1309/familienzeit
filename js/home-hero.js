// Kopfbereich der Startseite: Illustration (nach Tageszeit) und Tagesüberblick
import { h, icon } from './dom.js';
import { state, go } from './app.js';
import { startOfDay, addDays, startOfWeek, sameDay, toDateInput, fmtTime, WEEKDAYS_SHORT } from './dates.js';
import { onDay } from './recur.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

export function phaseOf(d = new Date()) {
  const hr = d.getHours();
  if (hr >= 5 && hr < 11) return 'morgen';
  if (hr >= 11 && hr < 18) return 'tag';
  if (hr >= 18 && hr < 22) return 'abend';
  return 'nacht';
}

const SCENES = {
  morgen: { sky: ['#FFD9B0', '#CFE6F7'], sun: { x: 62, y: 70, r: 17, c: '#FFB547' }, hill1: '#9FD9C4', hill2: '#5DBFA6', ink: '#263445', lit: false },
  tag:    { sky: ['#A9D8F5', '#E6F4FC'], sun: { x: 318, y: 84, r: 15, c: '#FFC94D' }, hill1: '#8ED3B9', hill2: '#3FB295', ink: '#173B63', lit: false },
  abend:  { sky: ['#F4A974', '#7B6BB0'], sun: { x: 316, y: 108, r: 19, c: '#FF8A4C' }, hill1: '#5E8F95', hill2: '#3A6670', ink: '#FFFFFF', lit: true },
  nacht:  { sky: ['#0F1B33', '#223A63'], moon: { x: 318, y: 86, r: 13 }, hill1: '#2C4B5E', hill2: '#1C3546', ink: '#FFFFFF', lit: true },
};

// Reihenfolge der Figuren: Erwachsene zuerst, dann Kinder
function figures() {
  const rank = { admin: 0, parent: 1, child: 2 };
  return [...state.members].sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3)).slice(0, 4);
}

function person(x, ground, m, tall) {
  const hgt = tall ? 46 : 32;
  const head = tall ? 8.5 : 7;
  const top = ground - hgt;
  const c = m.color || '#6B7A8F';
  const bodyTop = top + head * 2 + 2;
  const w = tall ? 11 : 9;
  return s('g', null,
    s('rect', { x: x - w, y: bodyTop, width: w * 2, height: ground - bodyTop, rx: w, fill: c }),
    s('circle', { cx: x, cy: top + head, r: head, fill: '#F6D2B8' }),
    s('path', { d: `M${x - head} ${top + head - 1} a${head} ${head} 0 0 1 ${head * 2} 0 q-${head} -3 -${head * 2} 0z`, fill: shade(c) }),
    s('circle', { cx: x - head * 0.36, cy: top + head + 1.2, r: 1, fill: '#3A2A20' }),
    s('circle', { cx: x + head * 0.36, cy: top + head + 1.2, r: 1, fill: '#3A2A20' }),
    s('path', { d: `M${x - 2.4} ${top + head + 3.6} q2.4 2 4.8 0`, stroke: '#3A2A20', 'stroke-width': '1', fill: 'none', 'stroke-linecap': 'round' }));
}

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.round(v * 0.6));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Wetter-Ebenen über dem Himmel
function weatherLayer(kind, ph) {
  if (!kind || kind === 'klar') return null;
  const dark = ph === 'nacht' || ph === 'abend';
  const cloud = (x, y, k, fill) => s('g', { fill, transform: `translate(${x} ${y}) scale(${k})` },
    s('ellipse', { cx: 0, cy: 0, rx: 26, ry: 11 }), s('ellipse', { cx: 14, cy: -8, rx: 16, ry: 12 }), s('ellipse', { cx: -12, cy: -5, rx: 12, ry: 9 }));
  const light = dark ? '#8C9AB5' : '#FFFFFF';
  const grey = dark ? '#5F6C86' : '#B9C4D2';
  const out = [];
  if (kind === 'heiter') out.push(cloud(250, 46, 0.9, light));
  if (kind === 'wolkig') out.push(cloud(70, 44, 1, light), cloud(262, 50, 1.1, light));
  if (['bedeckt', 'regen', 'schnee', 'gewitter', 'nebel'].includes(kind)) {
    const c = kind === 'schnee' ? light : grey;
    out.push(s('rect', { y: -60, width: 360, height: 220, fill: dark ? '#1A2438' : '#9AA8BA', opacity: kind === 'schnee' ? '.15' : '.32' }),
      cloud(40, 30, 1.3, c), cloud(150, 22, 1.5, c), cloud(270, 34, 1.4, c), cloud(330, 18, 1.1, c));
  }
  if (kind === 'regen' || kind === 'gewitter') {
    const drops = [];
    for (let i = 0; i < 34; i++) {
      const x = (i * 37) % 360 + (i % 3) * 4, y = 46 + ((i * 53) % 90);
      drops.push(s('path', { d: `M${x} ${y} l-3 9`, class: 'w-drop', style: `animation-delay:${(i % 7) * -0.13}s` }));
    }
    out.push(s('g', { stroke: dark ? '#9DB3D6' : '#6F8FB8', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: '.8' }, drops));
  }
  if (kind === 'gewitter') out.push(s('path', { d: 'M168 40 l-10 22 h9 l-6 18 l18 -26 h-9 l7 -14z', fill: '#FFD34D', class: 'w-flash' }));
  if (kind === 'schnee') {
    const flakes = [];
    for (let i = 0; i < 30; i++) {
      flakes.push(s('circle', { cx: (i * 41) % 360 + (i % 4) * 3, cy: 40 + ((i * 47) % 100), r: i % 3 ? 1.6 : 2.4, fill: '#FFFFFF', class: 'w-flake', style: `animation-delay:${(i % 9) * -0.4}s` }));
    }
    out.push(s('g', null, flakes));
  }
  if (kind === 'nebel') out.push(s('g', { fill: '#FFFFFF', opacity: dark ? '.18' : '.55' },
    s('rect', { x: -10, y: 84, width: 380, height: 10, rx: 5 }), s('rect', { x: 30, y: 102, width: 330, height: 9, rx: 4.5 }), s('rect', { x: -20, y: 120, width: 300, height: 9, rx: 4.5 })));
  return s('g', { class: 'w-layer' }, out);
}

export function heroScene(now = new Date(), weather = null) {
  const ph = phaseOf(now);
  const sc = SCENES[ph];
  const kind = weather?.kind || null;
  const hideSun = ['bedeckt', 'regen', 'schnee', 'gewitter', 'nebel'].includes(kind);
  const id = 'sky-' + ph;
  const ground = 140;
  const fam = figures();
  const xs = { 1: [224], 2: [214, 240], 3: [204, 230, 254], 4: [196, 222, 248, 270] }[fam.length] || [];
  const top = weather ? -52 : 0; // mit Wetteranzeige etwas mehr Himmel
  const svg = s('svg', { viewBox: `0 ${top} 360 ${160 - top}`, preserveAspectRatio: 'xMidYMax slice', class: 'hero-art', 'aria-hidden': 'true' },
    s('defs', null, s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': sc.sky[1] }), s('stop', { offset: '1', 'stop-color': sc.sky[0] }))),
    s('rect', { y: top, width: 360, height: 160 - top, fill: `url(#${id})` }),
    ph === 'nacht' ? [[40, 30], [90, 18], [140, 40], [205, 22], [250, 48], [330, 70], [20, 64], [175, 60]]
      .map(([x, y], i) => s('circle', { cx: x, cy: y, r: i % 3 ? 1 : 1.6, fill: '#FFFFFF', opacity: i % 2 ? '.6' : '.9' })) : null,
    sc.sun && !hideSun ? s('circle', { cx: sc.sun.x, cy: sc.sun.y, r: sc.sun.r, fill: sc.sun.c }) : null,
    sc.sun && !hideSun ? s('circle', { cx: sc.sun.x, cy: sc.sun.y, r: sc.sun.r + 9, fill: sc.sun.c, opacity: '.18' }) : null,
    sc.moon && !hideSun ? s('g', null,
      s('mask', { id: 'moon-cut' },
        s('rect', { width: 360, height: 160, fill: '#fff' }),
        s('circle', { cx: sc.moon.x + 6, cy: sc.moon.y - 4, r: sc.moon.r, fill: '#000' })),
      s('circle', { cx: sc.moon.x, cy: sc.moon.y, r: sc.moon.r, fill: '#F3EBC8', mask: 'url(#moon-cut)' })) : null,
    ph === 'tag' && !kind ? s('g', { fill: '#FFFFFF', opacity: '.9' },
      s('ellipse', { cx: 92, cy: 40, rx: 22, ry: 9 }), s('ellipse', { cx: 108, cy: 34, rx: 14, ry: 9 })) : null,
    weatherLayer(kind, ph),
    s('path', { d: 'M0 118 C 60 92, 120 96, 180 112 S 300 96, 360 104 V160 H0z', fill: sc.hill1 }),
    // Haus
    s('g', null,
      s('rect', { x: 100, y: 96, width: 58, height: 44, rx: 3, fill: ph === 'nacht' ? '#2A3F5C' : '#FFFFFF' }),
      s('path', { d: 'M94 99 L129 72 L164 99z', fill: '#E9A34A' }),
      s('rect', { x: 123, y: 116, width: 13, height: 24, rx: 2, fill: '#173B63' }),
      s('rect', { x: 107, y: 105, width: 11, height: 10, rx: 1.5, fill: sc.lit ? '#FFD66B' : '#BFDDF2' }),
      s('rect', { x: 141, y: 105, width: 11, height: 10, rx: 1.5, fill: sc.lit ? '#FFD66B' : '#BFDDF2' })),
    s('path', { d: 'M0 136 C 80 124, 160 128, 220 134 S 320 126, 360 130 V160 H0z', fill: sc.hill2 }),
    fam.map((m, i) => person(xs[i], ground + 4, m, m.role !== 'child')));
  return { svg, ink: sc.ink, phase: ph };
}

// Kopfkarte mit Begrüßung über der Illustration
export function heroCard({ title, subtitle, action, now = new Date(), weather = null }) {
  const { svg, ink, phase } = heroScene(now, weather);
  return h('section', { class: `hero hero-${phase}` + (weather ? ` has-weather w-${weather.kind}` : ''), style: { color: ink } },
    svg,
    h('div', { class: 'hero-text' },
      h('div', { class: 'grow' }, h('h1', null, title), h('p', null, subtitle),
        weather ? h('div', { class: 'hero-weather', title: weather.place || '' },
          h('span', { class: 'hw-emoji', 'aria-hidden': 'true' }, weather.emoji),
          h('strong', null, `${weather.temp}°`),
          h('span', null, `${weather.text}${Number.isFinite(weather.min) ? ` · ${weather.min}° / ${weather.max}°` : ''}`)) : null),
      action));
}

// ---------- Tagesüberblick ----------
function ring(done, total) {
  const r = 26, c = 2 * Math.PI * r;
  const part = total ? done / total : 1;
  return s('svg', { viewBox: '0 0 64 64', width: 64, height: 64, class: 'ov-ring', 'aria-hidden': 'true' },
    s('circle', { cx: 32, cy: 32, r, fill: 'none', 'stroke-width': 7, class: 'ov-ring-bg' }),
    s('circle', {
      cx: 32, cy: 32, r, fill: 'none', 'stroke-width': 7, 'stroke-linecap': 'round', class: 'ov-ring-fg',
      'stroke-dasharray': `${c * part} ${c}`, transform: 'rotate(-90 32 32)',
    }));
}

// tasks: alle Aufgaben, weekOccs: Termine der laufenden Woche
export function overviewCard({ tasks, weekOccs, now = new Date() }) {
  const me = state.me.user_id;
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const mine = tasks.filter((t) => {
    const ids = (t.task_assignees || []).map((a) => a.user_id);
    return ids.length === 0 || ids.includes(me);
  });
  // Heute fällig oder überfällig und noch offen + heute erledigt
  const doneToday = mine.filter((t) => t.status === 'done' && t.done_at && new Date(t.done_at) >= today);
  const openDue = mine.filter((t) => t.status !== 'done' && t.due_at && new Date(t.due_at) < tomorrow);
  const done = doneToday.length;
  const total = done + openDue.length;

  const todays = weekOccs.filter((o) => onDay(o, today)).sort((a, b) => a.start - b.start);
  const next = todays.find((o) => !o.allDay && o.end > now);

  const ws = startOfWeek(today);
  const counts = Array.from({ length: 7 }, (_, i) => weekOccs.filter((o) => onDay(o, addDays(ws, i))).length);
  const max = Math.max(3, ...counts);

  const bars = h('div', { class: 'ov-week', role: 'group', 'aria-label': 'Termine diese Woche' },
    counts.map((n, i) => {
      const d = addDays(ws, i);
      const isToday = sameDay(d, today);
      return h('button', {
        class: 'ov-bar' + (isToday ? ' today' : '') + (d < today ? ' past' : ''),
        'aria-label': `${WEEKDAYS_SHORT[i]}: ${n} Termine`,
        onClick: () => go(`/kalender?v=day&d=${toDateInput(d)}`),
      },
      h('span', { class: 'ov-n' }, n || ''),
      h('span', { class: 'ov-col' }, h('i', { style: { height: (n ? Math.max(12, (n / max) * 100) : 4) + '%' } })),
      h('span', { class: 'ov-wd' }, WEEKDAYS_SHORT[i]));
    }));

  return h('section', { class: 'card overview' },
    h('div', { class: 'ov-top' },
      h('button', { class: 'ov-tasks', onClick: () => go('/aufgaben') },
        h('span', { class: 'ov-ring-wrap' }, ring(done, total),
          h('span', { class: 'ov-ring-txt' }, total ? `${done}/${total}` : icon('check', 20))),
        h('span', { class: 'ov-lbl' },
          h('strong', null, 'Aufgaben'),
          h('span', null, !total ? 'heute nichts fällig' : done === total ? 'heute alles erledigt' : `${total - done} offen heute`))),
      h('button', { class: 'ov-events', onClick: () => go('/kalender?v=day') },
        h('strong', null, todays.length === 1 ? '1 Termin' : `${todays.length} Termine`),
        h('span', null, next ? `${fmtTime(next.start)} ${next.title}` : todays.length ? 'für heute erledigt' : 'heute frei'))),
    h('div', { class: 'ov-sub' }, 'Diese Woche'),
    bars);
}
