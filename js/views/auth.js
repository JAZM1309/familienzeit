import { h, icon, field, passwordInput, busy, toast } from '../dom.js';
import * as api from '../api.js';
import { state, afterLogin, go, logout } from '../app.js';

function frame(...content) {
  return h('div', { class: 'wrap auth' },
    h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }),
    h('h1', null, 'Familienzeit'),
    ...content);
}

function errorBox() {
  const box = h('div', { class: 'error', role: 'alert', hidden: true });
  box.show = (msg) => { box.textContent = msg; box.hidden = false; };
  box.clear = () => { box.hidden = true; };
  return box;
}

function emailInput() {
  return h('input', { class: 'input', type: 'email', autocomplete: 'email', inputmode: 'email', required: true, maxlength: 254 });
}

function nameInput(placeholder) {
  return h('input', { class: 'input', type: 'text', autocomplete: 'given-name', required: true, maxlength: 40, placeholder });
}

// Prüft Passwort und Wiederholung
function passwordsOk(pw, pw2, err) {
  if (pw.length < 8) { err.show('Das Passwort braucht mindestens 8 Zeichen.'); return false; }
  if (pw !== pw2) { err.show('Die beiden Passwörter stimmen nicht überein.'); return false; }
  return true;
}

async function finishSignup(result, err) {
  if (result?.session) {
    await afterLogin(result.session);
  } else {
    // Passiert nur, wenn in Supabase "Confirm email" noch eingeschaltet ist
    err.show('Konto angelegt, aber noch nicht aktiv: In Supabase muss „Confirm email“ ausgeschaltet sein. Danach hier anmelden.');
  }
}

// ---------- Anmelden ----------
export async function loginView() {
  if (state.session && state.me) { go('/'); return h('div'); }

  const err = errorBox();
  const email = emailInput();
  const pw = passwordInput({ autocomplete: 'current-password', minlength: null });
  const submit = h('button', { class: 'btn block', type: 'submit' }, 'Anmelden');

  const form = h('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      err.clear();
      busy(submit, true, 'Anmelden …');
      try {
        const { session } = await api.signIn(email.value, pw.input.value);
        await afterLogin(session);
      } catch (ex) {
        err.show(api.germanError(ex));
        busy(submit, false);
      }
    },
  }, err, field('E-Mail', email), field('Passwort', pw), submit);

  let open = false;
  try { open = await api.setupOpen(); } catch { /* offline */ }

  return frame(
    h('p', { class: 'tagline' }, 'Schön, dass du da bist.'),
    h('div', { class: 'card' }, form),
    h('p', { class: 'below' }, open
      ? h('span', null, 'Noch keine Familie angelegt? ', h('a', { href: '#/gruenden' }, 'Familie gründen'))
      : 'Passwort vergessen? Der Administrator deiner Familie kann dir einen Link zum Zurücksetzen schicken.'));
}

// ---------- Familie gründen (nur beim allerersten Start) ----------
export async function foundView() {
  let open = false;
  try { open = await api.setupOpen(); } catch { /* offline */ }
  if (!open) {
    return frame(h('div', { class: 'card', style: { marginTop: '20px' } },
      h('p', { style: { marginTop: 0 } }, 'Eure Familie ist bereits angelegt. Neue Mitglieder kommen nur über einen Einladungslink dazu.'),
      h('a', { class: 'btn block', href: '#/anmelden' }, 'Zur Anmeldung')));
  }

  const err = errorBox();
  const family = h('input', { class: 'input', type: 'text', required: true, maxlength: 60, placeholder: 'z. B. Familie Müller' });
  const name = nameInput('Dein Vorname');
  const email = emailInput();
  const pw = passwordInput({ autocomplete: 'new-password' });
  const pw2 = passwordInput({ autocomplete: 'new-password' });
  const submit = h('button', { class: 'btn teal block', type: 'submit' }, 'Familie gründen');

  const form = h('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      err.clear();
      if (!passwordsOk(pw.input.value, pw2.input.value, err)) return;
      busy(submit, true, 'Wird angelegt …');
      try {
        const result = await api.signUp({
          email: email.value, password: pw.input.value,
          displayName: name.value, familyName: family.value,
        });
        await finishSignup(result, err);
      } catch (ex) {
        err.show(api.germanError(ex));
      }
      busy(submit, false);
    },
  },
  err,
  h('div', { class: 'notice' }, icon('crown', 20),
    h('span', null, 'Du wirst dauerhaft Administrator. Diese Rolle kann später nicht übertragen werden.')),
  field('Name der Familie', family),
  field('Dein Name', name),
  field('E-Mail', email),
  field('Passwort', pw, 'Mindestens 8 Zeichen.'),
  field('Passwort wiederholen', pw2),
  submit);

  return frame(
    h('p', { class: 'tagline' }, 'Lege eure Familie an.'),
    h('div', { class: 'card' }, form),
    h('p', { class: 'below' }, 'Schon ein Konto? ', h('a', { href: '#/anmelden' }, 'Anmelden')));
}

// ---------- Einladung annehmen ----------
export async function inviteView({ params }) {
  const token = params.get('t') || '';

  if (state.session && state.me) {
    return frame(h('div', { class: 'card', style: { marginTop: '20px' } },
      h('p', { style: { marginTop: 0 } }, `Du bist auf diesem Gerät als ${state.me.display_name} angemeldet. Um die Einladung zu nutzen, melde dich zuerst ab.`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', style: { flex: 1 }, onClick: () => go('/') }, 'Zur App'),
        h('button', {
          class: 'btn', style: { flex: 1 },
          onClick: async () => { await logout(); location.hash = '/einladung?t=' + encodeURIComponent(token); },
        }, 'Abmelden'))));
  }

  let inv = null;
  let loadError = null;
  try { inv = token ? await api.checkInvitation(token) : null; } catch (e) { loadError = api.germanError(e); }

  if (!inv?.valid) {
    return frame(h('div', { class: 'card', style: { marginTop: '20px' } },
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('info')), h('h2', null, 'Einladung nicht gültig')),
      h('p', { class: 'muted' }, loadError || 'Dieser Link ist abgelaufen, wurde schon benutzt oder zurückgezogen. Bitte den Administrator um einen neuen Link.'),
      h('a', { class: 'btn ghost block', href: '#/anmelden' }, 'Zur Anmeldung')));
  }

  const roleText = inv.role === 'parent' ? 'als Elternteil' : 'als Kind';
  const until = new Date(inv.expires_at).toLocaleString('de-DE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  const err = errorBox();
  const name = nameInput('Dein Vorname');
  const email = emailInput();
  const pw = passwordInput({ autocomplete: 'new-password' });
  const pw2 = passwordInput({ autocomplete: 'new-password' });
  const submit = h('button', { class: 'btn teal block', type: 'submit' }, 'Konto erstellen');

  const form = h('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      err.clear();
      if (!passwordsOk(pw.input.value, pw2.input.value, err)) return;
      busy(submit, true, 'Wird erstellt …');
      try {
        // Kurz vorher erneut prüfen, um eine klare Meldung zu geben
        const again = await api.checkInvitation(token);
        if (!again?.valid) throw new Error('database error saving new user');
        const result = await api.signUp({
          email: email.value, password: pw.input.value, displayName: name.value, inviteToken: token,
        });
        await finishSignup(result, err);
      } catch (ex) {
        err.show(api.germanError(ex));
      }
      busy(submit, false);
    },
  },
  err,
  field('Dein Name', name),
  field('E-Mail', email, 'Die E-Mail-Adresse ist für deine Familie sichtbar.'),
  field('Passwort', pw, 'Mindestens 8 Zeichen.'),
  field('Passwort wiederholen', pw2),
  submit);

  return frame(
    h('p', { class: 'tagline' }, 'Du wurdest eingeladen.'),
    h('div', { class: 'card' },
      h('div', { class: 'notice' }, icon('users', 20),
        h('span', null, 'Du trittst ', h('strong', null, inv.family_name), ' ', roleText, ' bei. Der Link gilt bis ', until, ' Uhr.')),
      form));
}

// ---------- Neues Passwort über Link vom Administrator ----------
export async function resetView({ params }) {
  const token = params.get('t') || '';
  let info = null;
  let loadError = null;
  try { info = token ? await api.checkPasswordReset(token) : null; } catch (e) { loadError = api.germanError(e); }

  if (!info?.valid) {
    return frame(h('div', { class: 'card', style: { marginTop: '20px' } },
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('info')), h('h2', null, 'Link nicht gültig')),
      h('p', { class: 'muted' }, loadError || 'Dieser Link ist abgelaufen, wurde schon benutzt oder zurückgezogen. Bitte den Administrator um einen neuen.'),
      h('a', { class: 'btn ghost block', href: '#/anmelden' }, 'Zur Anmeldung')));
  }

  const err = errorBox();
  const pw = passwordInput({ autocomplete: 'new-password' });
  const pw2 = passwordInput({ autocomplete: 'new-password' });
  const submit = h('button', { class: 'btn teal block', type: 'submit' }, 'Passwort speichern');
  const form = h('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      err.clear();
      if (!passwordsOk(pw.input.value, pw2.input.value, err)) return;
      busy(submit, true, 'Wird gespeichert …');
      try {
        await api.setPasswordWithReset(token, pw.input.value);
        if (state.session) {
          // Auf diesem Gerät ist schon jemand angemeldet (z. B. der Administrator beim Testen): angemeldet bleiben
          location.hash = '/';
          setTimeout(() => toast(`Neues Passwort für ${info.display_name} gespeichert.`, { duration: 6000 }), 100);
        } else {
          location.hash = '/anmelden';
          setTimeout(() => toast('Passwort geändert. Bitte jetzt mit dem neuen Passwort anmelden.', { duration: 6000 }), 100);
        }
      } catch (ex) {
        err.show(ex.user ? ex.message : api.germanError(ex));
        busy(submit, false);
      }
    },
  }, err, field('Neues Passwort', pw, 'Mindestens 8 Zeichen.'), field('Passwort wiederholen', pw2), submit);

  return frame(
    h('p', { class: 'tagline' }, `Hallo ${info.display_name}, lege ein neues Passwort fest.`),
    h('div', { class: 'card' }, form));
}
