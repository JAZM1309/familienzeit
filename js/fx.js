// Kleine Erfolgsmomente: Konfetti, Stern für Kinder, kurzes Vibrieren.
// Rücksicht auf „Bewegung reduzieren“: dann gibt es nur ein dezentes Häkchen.
import { state } from './app.js';
import { vibrate } from './gestures.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['#E0607E', '#2F80ED', '#17A08F', '#EE8A22', '#3E9F4E', '#FFC94D'];
const PRAISE = ['Super!', 'Klasse!', 'Toll gemacht!', 'Spitze!', 'Prima!', 'Stark!'];

function origin(el) {
  const r = el?.getBoundingClientRect?.();
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
}

export function confetti(el, { count = 26 } = {}) {
  if (reduce()) return;
  const { x, y } = origin(el);
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'fx-bit' + (i % 3 === 0 ? ' round' : '');
    p.style.background = COLORS[i % COLORS.length];
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    layer.append(p);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist = 50 + Math.random() * 70;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 30;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(.6) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 60}px)) scale(.9) rotate(${Math.random() * 540}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 1400);
}

function star(el) {
  const { x, y } = origin(el);
  const box = document.createElement('div');
  box.className = 'fx-star';
  box.setAttribute('aria-hidden', 'true');
  box.style.left = x + 'px';
  box.style.top = y + 'px';
  box.innerHTML = '<svg viewBox="0 0 24 24" width="46" height="46"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.3l6.6-.8z" fill="#FFC94D" stroke="#E8A400" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const label = document.createElement('span');
  label.textContent = PRAISE[Math.floor(Math.random() * PRAISE.length)];
  box.append(label);
  document.body.append(box);
  if (!reduce()) {
    box.animate([
      { transform: 'translate(-50%, -50%) scale(.2)', opacity: 0 },
      { transform: 'translate(-50%, -120%) scale(1.15)', opacity: 1, offset: 0.35 },
      { transform: 'translate(-50%, -140%) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(-50%, -170%) scale(.9)', opacity: 0 },
    ], { duration: 1500, easing: 'ease-out', fill: 'forwards' });
  }
  setTimeout(() => box.remove(), reduce() ? 1200 : 1600);
}

// Aufgabe erledigt: Konfetti, für Kinder zusätzlich ein Stern mit Lob
export function celebrate(el) {
  vibrate([12, 40, 18]);
  el?.classList?.add('pop');
  confetti(el);
  if (state.me?.role === 'child') star(el);
}

// Kleiner Erfolg (z. B. Einkaufsartikel abgehakt)
export function tick(el) {
  vibrate(10);
  el?.classList?.add('pop');
}
