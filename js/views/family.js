import { h, icon, avatar, sheet, toast, confirmDialog, busy, ROLE_LABEL } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, isAdmin, loadData, render } from '../app.js';

const LIMITS = { parent: 1, child: 2 };

function inviteLink(token) {
  return `${location.origin}${location.pathname}#/einladung?t=${encodeURIComponent(token)}`;
}

function fmt(ts) {
  return new Date(ts).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function showLink(inv) {
  const roleText = inv.role === 'parent' ? 'Elternteil' : 'Kind';
  shareSheet('Einladung erstellt', inviteLink(inv.token),
    `Schicke diesen Link an das neue Familienmitglied (${roleText}). Er gilt bis ${fmt(inv.expires_at)} Uhr und nur einmal.`,
    'Aus Sicherheitsgründen wird der Link nur jetzt angezeigt. Geht er verloren, ziehst du die Einladung zurück und erstellst eine neue.',
    'Einladung zu Familienzeit', 'Hier ist deine Einladung zu unserer Familien-App:');
}

function shareSheet(title, link, text, notice, shareTitle, shareText) {
  sheet(title, () => h('div', null,
    h('p', { class: 'muted', style: { marginTop: 0 } }, text),
    h('div', { class: 'linkbox' }, link),
    h('div', { class: 'notice' }, icon('info', 20), h('span', null, notice)),
    h('div', { class: 'btn-row' },
      navigator.share ? h('button', {
        class: 'btn teal', style: { flex: 1 },
        onClick: async () => {
          try { await navigator.share({ title: shareTitle, text: shareText, url: link }); } catch { /* abgebrochen */ }
        },
      }, icon('share', 20), 'Teilen') : null,
      h('button', {
        class: 'btn ghost', style: { flex: 1 },
        onClick: async () => {
          try { await navigator.clipboard.writeText(link); toast('Link kopiert.'); }
          catch { toast('Kopieren nicht möglich. Bitte den Link markieren.', { type: 'error' }); }
        },
      }, icon('copy', 20), 'Kopieren'))));
}

// Passwort-Link für ein Familienmitglied (nur Administrator)
async function passwordLink(m) {
  const ok = await confirmDialog({
    title: `Passwort-Link für ${m.display_name}?`,
    text: `${m.display_name} kann damit ein neues Passwort festlegen. Der Link gilt 24 Stunden und nur einmal. Ein älterer Link wird dabei ungültig.`,
    ok: 'Link erstellen',
  });
  if (!ok) return;
  try {
    const r = await api.createPasswordReset(m.user_id);
    shareSheet('Passwort-Link erstellt', `${location.origin}${location.pathname}#/passwort-neu?t=${encodeURIComponent(r.token)}`,
      `Schicke diesen Link nur an ${m.display_name}, am besten direkt per Messenger. Er gilt bis ${fmt(r.expires_at)} Uhr.`,
      'Wer den Link hat, kann das Passwort ändern. Der Link wird nur jetzt angezeigt.',
      'Familienzeit: neues Passwort', 'Hier kannst du ein neues Passwort für Familienzeit festlegen:');
    render();
  } catch (e) { toast(api.germanError(e), { type: 'error' }); }
}

async function invite(role, button) {
  busy(button, true, 'Erstelle …');
  try {
    const inv = await api.createInvitation(role);
    showLink(inv);
    render();
  } catch (e) {
    toast(api.germanError(e), { type: 'error' });
    busy(button, false);
  }
}

function familyNameCard() {
  const name = state.family?.name || 'Unsere Familie';
  if (!isAdmin()) {
    return h('div', { class: 'hello' }, h('div', { class: 'grow' }, h('h1', null, name),
      h('p', null, `${state.members.length} von 4 Mitgliedern`)));
  }
  const edit = () => sheet('Familienname ändern', (close) => {
    const input = h('input', { class: 'input', value: name, maxlength: 60, required: true, 'aria-label': 'Familienname' });
    const save = h('button', { class: 'btn block', type: 'submit', style: { marginTop: '14px' } }, 'Speichern');
    return h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        busy(save, true);
        try {
          await api.updateFamilyName(state.family.id, input.value);
          state.family.name = input.value.trim();
          close(); render(); toast('Familienname gespeichert.');
        } catch (ex) { toast(api.germanError(ex), { type: 'error' }); busy(save, false); }
      },
    }, input, save);
  });
  return h('div', { class: 'hello' },
    h('div', { class: 'grow' }, h('h1', null, name), h('p', null, `${state.members.length} von 4 Mitgliedern`)),
    h('button', { class: 'btn ghost small', onClick: edit }, 'Umbenennen'));
}

function memberRow(m) {
  const me = m.user_id === state.me.user_id;
  return h('div', { class: 'list-row' },
    avatar(m, 46, urlFor(m)),
    h('div', { class: 'grow' },
      h('div', { class: 'title' }, m.display_name,
        me ? h('span', { class: 'pill' }, 'Du') : null),
      h('div', { class: 'sub' }, ROLE_LABEL[m.role], ' · ', m.email)),
    isAdmin() && !me ? h('button', { class: 'iconbtn', 'aria-label': `Passwort-Link für ${m.display_name}`, title: 'Passwort vergessen? Link erstellen', onClick: () => passwordLink(m) }, icon('lock', 20)) : null);
}

export async function familyView() {
  const admin = isAdmin();
  let open = [];
  let resets = [];
  if (admin) {
    try { open = await api.openInvitations(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
    try { resets = await api.openPasswordResets(); } catch { /* egal */ }
  }

  const rows = state.members.map(memberRow);

  // Freie Plätze
  const slots = [];
  for (const role of ['parent', 'child']) {
    const taken = state.members.filter((m) => m.role === role).length + open.filter((i) => i.role === role).length;
    for (let i = taken; i < LIMITS[role]; i++) {
      const btn = admin ? h('button', { class: 'btn teal small' }, 'Einladen') : null;
      btn?.addEventListener('click', () => invite(role, btn));
      slots.push(h('div', { class: 'list-row' },
        h('div', { class: 'slot-empty' }, icon('plus', 20)),
        h('div', { class: 'grow' },
          h('div', { class: 'title', style: { fontWeight: 500 } }, `${ROLE_LABEL[role]} – Platz frei`),
          admin ? h('div', { class: 'sub' }, 'Per Link einladen') : null),
        btn));
    }
  }

  const invitesCard = admin && open.length ? h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('mail', 19)), h('h2', null, 'Offene Einladungen')),
    open.map((inv) => h('div', { class: 'list-row' },
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, ROLE_LABEL[inv.role]),
        h('div', { class: 'sub' }, `gültig bis ${fmt(inv.expires_at)} Uhr`)),
      h('button', {
        class: 'btn danger small',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Einladung zurückziehen?',
            text: 'Der Link funktioniert danach nicht mehr. Du kannst jederzeit eine neue Einladung erstellen.',
            ok: 'Zurückziehen', danger: true,
          });
          if (!ok) return;
          try { await api.revokeInvitation(inv.id); toast('Einladung zurückgezogen.'); render(); }
          catch (e) { toast(api.germanError(e), { type: 'error' }); }
        },
      }, 'Zurückziehen')))) : null;

  // Daten im Hintergrund auffrischen, falls sich jemand neu angemeldet hat
  loadData().catch(() => {});

  return h('div', null,
    familyNameCard(),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('users', 19)), h('h2', null, 'Mitglieder')),
      rows, slots),
    invitesCard,
    admin && resets.length ? h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('lock', 19)), h('h2', null, 'Offene Passwort-Links')),
      resets.map((r) => h('div', { class: 'list-row' },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, state.members.find((m) => m.user_id === r.user_id)?.display_name || 'Mitglied'),
          h('div', { class: 'sub' }, `gültig bis ${fmt(r.expires_at)} Uhr`)),
        h('button', {
          class: 'btn danger small',
          onClick: async () => {
            try { await api.revokePasswordReset(r.id); toast('Link zurückgezogen.'); render(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
          },
        }, 'Zurückziehen')))) : null,
    admin ? h('p', { class: 'muted small', style: { padding: '0 4px' } },
      'Einladungslinks gelten 72 Stunden und nur einmal. Hat jemand sein Passwort vergessen, tippe beim Mitglied auf das Schloss. Mitglieder können nicht entfernt werden.') : null);
}
