// Push-Benachrichtigungen auf diesem Gerät ein- und ausschalten
import { h, icon, toast, busy } from './dom.js';
import * as api from './api.js';
import { state } from './app.js';

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function bytesToB64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'Android' : /iphone/i.test(ua) ? 'iPhone' : isIos() ? 'iPad'
    : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Gerät';
  const br = /edg\//i.test(ua) ? 'Edge' : /firefox/i.test(ua) ? 'Firefox' : /samsungbrowser/i.test(ua) ? 'Samsung Internet'
    : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const key = await api.pushPublicKey();
  if (!key) throw new Error('nokey');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const oldKey = sub?.options?.applicationServerKey;
  if (sub && oldKey && bytesToB64url(oldKey) !== key) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
  await api.registerPush(sub, deviceLabel());
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  try { await api.unregisterPush(sub.endpoint); } catch { /* egal */ }
  await sub.unsubscribe();
}

// Beim Abmelden: Gerät auf dem Server abmelden, damit niemand fremde Meldungen bekommt
export async function forgetDevice() {
  const sub = await currentSubscription().catch(() => null);
  if (sub) { try { await api.unregisterPush(sub.endpoint); } catch { /* egal */ } }
}

// Beim Start: Abo des angemeldeten Kontos auffrischen
export async function refreshPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription().catch(() => null);
  if (sub) { try { await api.registerPush(sub, deviceLabel()); } catch { /* egal */ } }
}

// ---------- Profil-Karte ----------
const TYPES = [
  ['event_new', 'Neue Termine'],
  ['event_changed', 'Geänderte und abgesagte Termine'],
  ['reminder', 'Erinnerungen (Termine und Aufgaben)'],
  ['task', 'Neue, zugewiesene und erledigte Aufgaben'],
  ['comment', 'Neue Kommentare'],
];

export function notificationsCard() {
  const card = h('section', { class: 'card' });

  const draw = async () => {
    const status = h('div');
    const notify = state.me.settings?.notify || {};

    if (!pushSupported() || (isIos() && !isStandalone())) {
      status.append(h('div', { class: 'notice' }, icon('info', 20), h('span', null, isIos()
        ? 'Auf iPhone und iPad funktionieren Benachrichtigungen nur, wenn Familienzeit über „Teilen“ → „Zum Home-Bildschirm“ installiert ist. Danach die App vom Home-Bildschirm öffnen.'
        : 'Dieser Browser unterstützt keine Push-Benachrichtigungen. Die Glocke in der App zeigt trotzdem alle Meldungen.')));
    } else if (Notification.permission === 'denied') {
      status.append(h('div', { class: 'notice' }, icon('info', 20),
        h('span', null, 'Benachrichtigungen sind für Familienzeit blockiert. Bitte in den Einstellungen des Browsers bzw. des Handys für diese App erlauben.')));
    } else {
      const sub = await currentSubscription().catch(() => null);
      if (sub && Notification.permission === 'granted') {
        const test = h('button', { class: 'btn ghost small' }, 'Test senden');
        test.addEventListener('click', async () => {
          busy(test, true, 'Sende …');
          try { await api.sendTestPush(); toast('Test verschickt. Er sollte in wenigen Sekunden ankommen.'); }
          catch (e) { toast(api.germanError(e), { type: 'error' }); }
          busy(test, false);
        });
        const off = h('button', { class: 'btn ghost small' }, 'Ausschalten');
        off.addEventListener('click', async () => {
          busy(off, true, '…');
          try { await disablePush(); toast('Auf diesem Gerät ausgeschaltet.'); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
          draw();
        });
        status.append(
          h('p', { class: 'small', style: { margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '6px' } },
            h('span', { style: { color: 'var(--ok)', display: 'inline-flex' } }, icon('check', 18)), 'Auf diesem Gerät eingeschaltet.'),
          h('div', { class: 'btn-row' }, test, off));
      } else {
        const on = h('button', { class: 'btn teal block' }, icon('bell', 18), 'Auf diesem Gerät einschalten');
        on.addEventListener('click', async () => {
          busy(on, true, 'Wird eingeschaltet …');
          try {
            await enablePush();
            toast('Benachrichtigungen sind eingeschaltet.');
          } catch (e) {
            const m = e.message === 'denied' ? 'Ohne Erlaubnis können keine Benachrichtigungen kommen.'
              : e.message === 'nokey' ? 'Der Versand wird gerade eingerichtet. Bitte in 2 Minuten noch einmal versuchen.'
                : api.germanError(e);
            toast(m, { type: 'error', duration: 6000 });
          }
          draw();
        });
        status.append(on);
      }
    }

    const toggles = TYPES.map(([key, label]) => h('div', { class: 'switch-row', style: { marginBottom: '10px', fontWeight: 500 } },
      h('span', null, label),
      h('label', { class: 'toggle' },
        h('input', {
          type: 'checkbox', checked: notify[key] !== false, 'aria-label': label,
          onChange: async (e) => {
            const settings = { ...(state.me.settings || {}), notify: { ...(state.me.settings?.notify || {}), [key]: e.target.checked } };
            try { await api.updateMe(state.me.user_id, { settings }); state.me.settings = settings; }
            catch (ex) { e.target.checked = !e.target.checked; toast(api.germanError(ex), { type: 'error' }); }
          },
        }),
        h('span'))));

    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('bell', 19)), h('h3', null, 'Benachrichtigungen')),
      status,
      h('div', { class: 'section-title', style: { margin: '18px 0 10px' } }, 'Push-Nachricht bei'),
      ...toggles,
      h('p', { class: 'muted small', style: { margin: 0 } },
        'Gilt für alle deine Geräte. Die Glocke oben zeigt immer alle Meldungen, auch ausgeschaltete.'));
  };
  draw();
  return card;
}
