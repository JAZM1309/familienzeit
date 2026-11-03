// App-Sperre mit Fingerabdruck oder Gesichtserkennung (WebAuthn).
// Die biometrischen Daten verlassen das Gerät nie: Das Handy prüft selbst und
// bestätigt der App nur "ja, das ist die Person". Gespeichert wird nur eine Kennung.
import { h, icon } from './dom.js';

const key = (uid) => `fz-lock-${uid}`;
const LOCK_AFTER_MS = 5 * 60 * 1000; // nach 5 Minuten im Hintergrund wieder sperren

export async function lockAvailable() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export function lockEnabled(uid) {
  try { return !!localStorage.getItem(key(uid)); } catch { return false; }
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function enableLock(uid, name) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Familienzeit', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `familienzeit-${name}`, displayName: name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  localStorage.setItem(key(uid), b64(cred.rawId));
}

export function disableLock(uid) {
  try { localStorage.removeItem(key(uid)); } catch { /* egal */ }
}

export async function verify(uid) {
  const id = localStorage.getItem(key(uid));
  if (!id) return true;
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64(id), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return true;
}

// Sperrbildschirm über der App
export function showLockScreen(uid, name, onPasswordLogin) {
  return new Promise((resolve) => {
    const err = h('p', { class: 'muted small', style: { minHeight: '1.4em' } });
    const unlock = async () => {
      err.textContent = '';
      try { await verify(uid); overlay.remove(); resolve(); }
      catch { err.textContent = 'Nicht erkannt. Bitte noch einmal versuchen.'; }
    };
    const overlay = h('div', { class: 'lock-screen' },
      h('div', { class: 'lock-box' },
        h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }),
        h('h1', null, 'Familienzeit'),
        h('p', { class: 'muted' }, `Hallo ${name}, bitte entsperren.`),
        h('button', { class: 'btn teal block', onClick: unlock }, icon('lock', 18), 'Entsperren'),
        err,
        h('button', { class: 'link-btn', onClick: () => { overlay.remove(); resolve(); onPasswordLogin(); } }, 'Stattdessen mit Passwort anmelden')));
    document.body.append(overlay);
    setTimeout(unlock, 300);
  });
}

// Beim Zurückkehren nach längerer Zeit erneut sperren
export function watchBackground(getUser, onLocked) {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) {
      const u = getUser();
      if (u && lockEnabled(u.user_id) && !document.querySelector('.lock-screen')) onLocked(u);
    }
  });
}
