// Einstellungen ab Version 1.6: Sicherheit, Geräte, Standard-Erinnerungen
import { h, icon, toast, confirmDialog, busy } from './dom.js';
import * as api from './api.js';
import { state } from './app.js';
import { lockAvailable, lockEnabled, enableLock, disableLock } from './lock.js';
import { sharedDevice, setSharedDevice } from './offline.js';
import { reminderText } from './events.js';
import { fmtDateTime } from './dates.js';

function deviceName(ua = '') {
  const os = /android/i.test(ua) ? 'Android' : /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad'
    : /windows/i.test(ua) ? 'Windows-PC' : /mac os|macintosh/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Gerät';
  const br = /edg\//i.test(ua) ? 'Edge' : /firefox|fxios/i.test(ua) ? 'Firefox' : /samsungbrowser/i.test(ua) ? 'Samsung Internet'
    : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

function switchRow(label, hint, checked, onChange, disabled) {
  return h('div', { style: { marginBottom: '14px' } },
    h('div', { class: 'switch-row', style: { marginBottom: '2px' } },
      h('span', null, label),
      h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked, disabled, 'aria-label': label, onChange: (e) => onChange(e.target) }),
        h('span'))),
    hint ? h('div', { class: 'hint', style: { marginTop: 0 } }, hint) : null);
}

export function securityCard() {
  const card = h('section', { class: 'card' });
  const uid = state.me.user_id;

  const draw = async () => {
    const canLock = await lockAvailable();
    const devices = h('div', null, h('p', { class: 'muted small' }, 'Geräte werden geladen …'));

    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('shield', 19)), h('h3', null, 'Sicherheit und Geräte')),
      switchRow('Mit Fingerabdruck oder Gesicht entsperren',
        canLock ? 'Die App fragt beim Öffnen und nach 5 Minuten im Hintergrund danach. Die biometrischen Daten bleiben auf dem Gerät.'
          : 'Auf diesem Gerät nicht verfügbar.',
        lockEnabled(uid),
        async (el) => {
          if (el.checked) {
            try { await enableLock(uid, state.me.display_name); toast('Entsperren per Fingerabdruck ist eingeschaltet.'); }
            catch { el.checked = false; toast('Einrichtung abgebrochen.', { type: 'error' }); }
          } else { disableLock(uid); toast('Ausgeschaltet.'); }
        }, !canLock),
      switchRow('Gemeinsam genutztes Gerät',
        'Für ein Familien-Tablet: Hier wird nichts für die Offline-Nutzung gespeichert, und nach 10 Minuten ohne Bedienung wirst du abgemeldet. Gilt nur für dieses Gerät.',
        sharedDevice(),
        (el) => { setSharedDevice(el.checked); toast(el.checked ? 'Als gemeinsames Gerät markiert.' : 'Wieder als persönliches Gerät markiert.'); }),
      h('div', { class: 'section-title', style: { margin: '6px 0 8px' } }, 'Angemeldete Geräte'),
      devices);

    let sessions = null;
    try { sessions = await api.mySessions(); } catch { /* nicht verfügbar */ }
    const others = h('button', { class: 'btn ghost block', style: { marginTop: '10px' } }, 'Alle anderen Geräte abmelden');
    others.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Andere Geräte abmelden?', text: 'Alle anderen Geräte müssen sich danach neu anmelden. Dieses Gerät bleibt angemeldet.', ok: 'Abmelden', danger: true }))) return;
      busy(others, true);
      try { await api.signOutOthers(); toast('Andere Geräte werden abgemeldet.'); draw(); }
      catch (e) { toast(api.germanError(e), { type: 'error' }); busy(others, false); }
    });

    if (!sessions) {
      devices.replaceChildren(h('p', { class: 'muted small', style: { margin: 0 } }, 'Die Geräteliste kann gerade nicht geladen werden.'), others);
      return;
    }
    devices.replaceChildren(
      ...sessions.map((s) => h('div', { class: 'list-row' },
        h('div', { class: 'slot-empty', style: { borderStyle: 'solid' } }, icon(s.current ? 'check' : 'user', 18)),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, deviceName(s.user_agent || ''), s.current ? h('span', { class: 'pill' }, 'Dieses Gerät') : null),
          h('div', { class: 'sub' }, `zuletzt aktiv ${fmtDateTime(new Date(s.last_active))}`)),
        s.current ? null : h('button', {
          class: 'btn danger small',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Gerät abmelden?', text: `${deviceName(s.user_agent || '')} wird spätestens in einer Stunde abgemeldet.`, ok: 'Abmelden', danger: true }))) return;
            try { await api.revokeSession(s.id); toast('Gerät abgemeldet.'); draw(); }
            catch (e) { toast(api.germanError(e), { type: 'error' }); }
          },
        }, 'Abmelden'))),
      sessions.length > 1 ? others : null);
  };
  draw();
  return card;
}

const EVENT_OPTS = [5, 15, 30, 60, 1440];
const TASK_OPTS = [0, 60, 1440];

export function defaultReminders(kind) {
  return state.me.settings?.defaults?.[kind] || [];
}

export function defaultsCard() {
  const card = h('section', { class: 'card' });
  const draw = () => {
    const chips = (kind, opts) => h('div', { class: 'chips' }, opts.map((m) => {
      const on = defaultReminders(kind).includes(m);
      return h('button', {
        type: 'button', class: 'fchip', 'aria-pressed': String(on),
        onClick: async () => {
          const set = new Set(defaultReminders(kind));
          if (on) set.delete(m); else set.add(m);
          const settings = { ...(state.me.settings || {}), defaults: { ...(state.me.settings?.defaults || {}), [kind]: [...set].sort((a, b) => a - b) } };
          try { await api.updateMe(state.me.user_id, { settings }); state.me.settings = settings; draw(); }
          catch (e) { toast(api.germanError(e), { type: 'error' }); }
        },
      }, m === 0 ? 'Bei Fälligkeit' : reminderText(m).replace(' vorher', ''));
    }));
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('clock', 19)), h('h3', null, 'Standard-Erinnerungen')),
      h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Werden bei neuen Einträgen vorausgewählt und lassen sich dort jederzeit ändern.'),
      h('div', { class: 'field' }, h('label', null, 'Neue Termine'), chips('event', EVENT_OPTS)),
      h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Neue Aufgaben mit Fälligkeit'), chips('task', TASK_OPTS)));
  };
  draw();
  return card;
}
