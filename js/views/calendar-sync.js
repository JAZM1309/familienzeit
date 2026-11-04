// Version 1.7: Kalenderdatei importieren und externe Kalender verbinden
import { h, icon, avatar, sheet, toast, field, busy, confirmDialog } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, go, render } from '../app.js';
import { icsToEvents } from '../ics.js';
import { ruleText } from '../recur.js';
import { fmtDayShort, fmtTime, fmtDateTime, toDateInput, addDays } from '../dates.js';
import { VISIBILITY } from '../events.js';

const isParent = () => ['admin', 'parent'].includes(state.me.role);
const visOptions = () => [['family', 'Familie'], ...(isParent() ? [['parents', 'Nur Eltern']] : []), ['private', 'Persönlich']];

function seg(options, value, onPick, label) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const draw = (v) => el.replaceChildren(...options.map(([k, l]) => h('button', {
    type: 'button', 'aria-pressed': String(k === v), onClick: () => { draw(k); onPick(k); },
  }, l)));
  draw(value);
  return el;
}

// Farbauswahl für Kalender
export const CAL_COLORS = ['#5B7FDB', '#2F8FB8', '#27A99A', '#3F9C4F', '#B08A2E', '#E9A34A', '#D9604C', '#C9567A', '#8A63D2', '#6B7A8F'];

export function suggestColor(used = []) {
  const taken = new Set([...state.members.map((m) => m.color.toUpperCase()), ...used.map((c) => c.toUpperCase())]);
  return CAL_COLORS.find((c) => !taken.has(c)) || CAL_COLORS[0];
}

function colorPicker(value, onPick) {
  const wrap = h('div', { class: 'swatches' });
  const draw = (v) => {
    const custom = h('input', { type: 'color', value: v, 'aria-label': 'Eigene Farbe wählen' });
    custom.addEventListener('change', () => { draw(custom.value.toUpperCase()); onPick(custom.value.toUpperCase()); });
    const isCustom = !CAL_COLORS.includes(v.toUpperCase());
    wrap.replaceChildren(
      ...CAL_COLORS.map((c) => h('button', {
        type: 'button', class: 'swatch', style: { background: c }, 'aria-label': `Farbe ${c}`, 'aria-pressed': String(c === v.toUpperCase()),
        onClick: () => { draw(c); onPick(c); },
      }, c === v.toUpperCase() ? icon('check', 18) : null)),
      h('label', { class: 'swatch custom', 'aria-pressed': String(isCustom), title: 'Eigene Farbe' }, isCustom ? icon('check', 18) : null, custom));
  };
  draw(value);
  return wrap;
}

function chip(label, on, onToggle, extra) {
  const b = h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(on) }, extra, label);
  b.addEventListener('click', () => { const now = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(now)); onToggle(now); });
  return b;
}

// Auswahl im Kalender: Import oder Verbindungen
export function calendarMenu() {
  sheet('Kalender verbinden', (close) => h('div', { class: 'quick-grid', style: { gridTemplateColumns: '1fr' } },
    h('button', { onClick: () => { close(); go('/kalender-import'); } },
      h('span', { class: 'card-icon' }, icon('download', 19)), h('strong', null, 'Kalenderdatei importieren'),
      h('span', { class: 'muted small' }, 'Termine aus einer .ics-Datei einmalig übernehmen, z. B. aus dem Apple-Kalender oder einem Schulkalender.')),
    h('button', { onClick: () => { close(); go('/kalender-abos'); } },
      h('span', { class: 'card-icon' }, icon('link', 19)), h('strong', null, 'Meine Kalender'),
      h('span', { class: 'muted small' }, 'Google- oder Outlook-Kalender abonnieren, Farben ändern, importierte Kalender verwalten.'))));
}

// ---------- Import ----------
function whenText(e) {
  const s = new Date(e.starts_at);
  const day = fmtDayShort(s) + ' ' + s.getFullYear();
  if (e.recurring) return `${ruleText(e.rrule, e.until, s)} · ab ${day}${e.all_day ? '' : ', ' + fmtTime(s)}`;
  return e.all_day ? `${day} · ganztägig` : `${day}, ${fmtTime(s)} – ${fmtTime(new Date(e.ends_at))}`;
}

export async function importView() {
  const root = h('div');
  const body = h('div');
  const fileInput = h('input', { type: 'file', accept: '.ics,text/calendar', class: 'sr-only', 'aria-label': 'Kalenderdatei auswählen' });

  const pickCard = h('section', { class: 'card', style: { textAlign: 'center' } },
    h('div', { class: 'card-icon', style: { margin: '4px auto 12px', width: '48px', height: '48px' } }, icon('download', 24)),
    h('p', { style: { marginTop: 0 } }, 'Wähle eine Kalenderdatei (.ics) aus. Du siehst zuerst eine Vorschau und entscheidest dann, was übernommen wird.'),
    h('label', { class: 'btn teal' }, icon('download', 18), 'Datei auswählen', fileInput),
    h('p', { class: 'muted small', style: { marginBottom: 0 } },
      'Apple-Kalender: am Mac in der Kalender-App „Ablage → Exportieren“. Am iPhone geht der Export nur über einen Mac oder iCloud.com.'));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Die Datei ist größer als 5 MB.', { type: 'error' }); return; }
    let parsed;
    try {
      const text = await file.text();
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('kein');
      parsed = icsToEvents(text, { from: new Date(Date.now() - 30 * 86400000), to: new Date(Date.now() + 3 * 365 * 86400000) });
    } catch {
      toast('Das ist keine gültige Kalenderdatei.', { type: 'error' });
      return;
    }
    if (!parsed.events.length) { toast('In der Datei sind keine aktuellen oder künftigen Termine.', { type: 'error' }); return; }
    await showPreview(parsed, file.name);
  });

  async function showPreview({ calName, events }, fileName) {
    // Mögliche Doppelte: gleiche Kennung oder gleicher Titel zur gleichen Zeit
    let existing = [];
    try {
      const starts = events.map((e) => new Date(e.starts_at).getTime());
      const from = new Date(Math.max(Math.min(...starts), Date.now() - 400 * 86400000));
      const to = addDays(new Date(Math.max(...events.map((e) => new Date(e.ends_at).getTime()))), 1);
      existing = await api.eventsInRange(from, to);
    } catch { /* ohne Prüfung weiter */ }
    const uids = new Set(existing.map((e) => e.external_uid).filter(Boolean));
    const pairs = new Set(existing.map((e) => `${e.title.trim().toLowerCase()}|${new Date(e.starts_at).getTime()}`));
    const dup = (e) => uids.has(e.external_uid) || pairs.has(`${e.title.trim().toLowerCase()}|${new Date(e.starts_at).getTime()}`);

    const chosen = new Set(events.map((e, i) => (dup(e) ? -1 : i)).filter((i) => i >= 0));
    let visibility = 'family';
    let existingImports = [];
    try { existingImports = await api.listImports(); } catch { /* egal */ }
    let color = suggestColor(existingImports.map((i) => i.color));
    const calNameInput = h('input', { class: 'input', value: calName || fileName.replace(/\.ics$/i, ''), maxlength: 60 });
    const people = new Set();
    const peopleWrap = h('div');
    const drawPeople = () => {
      if (visibility === 'private') { peopleWrap.replaceChildren(h('p', { class: 'muted small', style: { margin: 0 } }, 'Persönliche Termine gehören nur dir.')); return; }
      const allowed = state.members.filter((m) => visibility !== 'parents' || m.role !== 'child');
      for (const id of [...people]) if (!allowed.some((m) => m.user_id === id)) people.delete(id);
      peopleWrap.replaceChildren(h('div', { class: 'chips' }, allowed.map((m) => chip(m.user_id === state.me.user_id ? 'Ich' : m.display_name, people.has(m.user_id),
        (on) => { if (on) people.add(m.user_id); else people.delete(m.user_id); }, avatar(m, 22, urlFor(m))))),
      h('div', { class: 'hint' }, 'Niemand ausgewählt = Termine für die ganze Familie.'));
    };
    const visHint = h('div', { class: 'hint' }, VISIBILITY[visibility].hint);
    drawPeople();

    const count = h('span');
    const submit = h('button', { class: 'btn teal block' }, icon('download', 18), count);
    const updateCount = () => { count.textContent = chosen.size === 1 ? '1 Termin importieren' : `${chosen.size} Termine importieren`; submit.disabled = chosen.size === 0; };
    const list = h('div', { class: 'imp-list' }, events.map((e, i) => {
      const isDup = dup(e);
      return h('label', { class: 'pick-row' },
        h('input', { type: 'checkbox', checked: chosen.has(i), onChange: (ev) => { if (ev.target.checked) chosen.add(i); else chosen.delete(i); updateCount(); } }),
        h('span', { class: 'grow' },
          h('span', { class: 'imp-title' }, e.title, e.recurring ? h('span', { class: 'ev-tag' }, icon('repeat', 13)) : null,
            isDup ? h('span', { class: 'pill orange' }, 'schon vorhanden') : null),
          h('span', { class: 'imp-sub' }, whenText(e), e.location ? ` · ${e.location}` : '')));
    }));
    const toggleAll = h('button', { class: 'link-btn', type: 'button' }, 'Alle auswählen');
    toggleAll.addEventListener('click', () => {
      const all = chosen.size < events.length;
      chosen.clear();
      if (all) events.forEach((_, i) => chosen.add(i));
      list.querySelectorAll('input').forEach((c, i) => { c.checked = chosen.has(i); });
      toggleAll.textContent = all ? 'Alle abwählen' : 'Alle auswählen';
      updateCount();
    });
    updateCount();

    submit.addEventListener('click', async () => {
      const items = events.filter((_, i) => chosen.has(i)).map(({ recurring, ...rest }) => rest);
      busy(submit, true, 'Wird importiert …');
      try {
        const n = await api.importEvents(items, visibility === 'private' ? [] : [...people], visibility,
          calNameInput.value.trim() || 'Importierter Kalender', color);
        toast(n === 1 ? '1 Termin importiert.' : `${n} Termine importiert.`);
        const firstStart = items.map((e) => e.starts_at).sort()[0];
        go(`/kalender?v=month&d=${toDateInput(new Date(Math.max(new Date(firstStart).getTime(), Date.now())))}`);
      } catch (e) { toast(api.germanError(e), { type: 'error', duration: 6000 }); busy(submit, false); }
    });

    const dupCount = events.filter(dup).length;
    body.replaceChildren(
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('calendar', 19)),
          h('h2', null, calName || fileName), h('button', { class: 'link-btn', onClick: () => body.replaceChildren(pickCard) }, 'Andere Datei')),
        h('p', { class: 'muted small', style: { margin: 0 } },
          `${events.length === 1 ? '1 Termin' : events.length + ' Termine'} gefunden (Vergangenes, das älter als 30 Tage ist, wird ausgelassen).`, dupCount ? ` ${dupCount} davon sind wohl schon im Kalender und deshalb abgewählt.` : '')),
      h('section', { class: 'card' },
        field('Name des Kalenders', calNameInput),
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Farbe'), colorPicker(color, (c) => { color = c; }))),
      h('section', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Wer'), peopleWrap),
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Sichtbarkeit'),
          seg(visOptions(), visibility, (v) => { visibility = v; visHint.textContent = VISIBILITY[v].hint; drawPeople(); }, 'Sichtbarkeit'), visHint)),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Termine'), toggleAll),
        list),
      submit);
  }

  body.append(pickCard);
  root.append(
    h('div', { class: 'hello' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onClick: () => go('/kalender') }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { style: { fontSize: '1.35rem' } }, 'Kalender importieren'))),
    body);
  return root;
}

// ---------- Externe Kalender ----------
const PROVIDERS = {
  google: {
    name: 'Google Kalender', label: 'Google',
    steps: ['Google Kalender am PC im Browser öffnen (am Handy geht es nicht).', 'Oben rechts Zahnrad → „Einstellungen“.',
      'Links unter „Meine Kalender“ den Kalender anklicken.', 'Bis „Kalender integrieren“ scrollen.',
      '„Privatadresse im iCal-Format“ kopieren und hier einfügen.'],
  },
  outlook: {
    name: 'Outlook', label: 'Outlook',
    steps: ['outlook.com oder Outlook im Web öffnen.', 'Zahnrad → „Kalender“ → „Freigegebene Kalender“.',
      'Unter „Kalender veröffentlichen“ den Kalender und „Kann alle Details anzeigen“ wählen → „Veröffentlichen“.',
      'Den „ICS“-Link kopieren und hier einfügen.'],
  },
  other: {
    name: 'Anderer Kalender', label: 'Kalender',
    steps: ['Den Abo-Link des Kalenders kopieren (beginnt mit https:// oder webcal:// und endet meist auf .ics).',
      'Viele Schulen, Vereine und Müllabfuhr-Kalender bieten so einen Link an.'],
  },
};

function statusOf(f) {
  if (f.paused) return h('span', { class: 'muted' }, 'Pausiert');
  if (f.last_error) return h('span', { class: 'overdue' }, f.last_error);
  if (!f.last_sync_at || f.sync_requested) return h('span', { class: 'muted' }, 'Wird gleich abgeglichen …');
  return h('span', { class: 'muted' }, `Zuletzt abgeglichen ${fmtDateTime(new Date(f.last_sync_at))} · ${f.event_count} ${f.event_count === 1 ? 'Termin' : 'Termine'}`);
}

function feedForm(initial, onSave) {
  return (close) => {
    const err = h('div', { class: 'error', role: 'alert', hidden: true });
    let provider = initial.provider || 'google';
    let visibility = initial.visibility || 'private';
    let color = initial.color || suggestColor(initial.usedColors || []);
    const isNew = !initial.id;
    const url = h('input', { class: 'input', type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://… oder webcal://…', maxlength: 2000 });
    const label = h('input', { class: 'input', value: initial.label || PROVIDERS[provider].label, maxlength: 60 });
    const assign = h('input', { type: 'checkbox', checked: initial.assign_me !== false, 'aria-label': 'Mir zuordnen' });
    const steps = h('ol', { class: 'steps' });
    const assignRow = h('div', { class: 'switch-row' }, h('span', null, 'Mir zuordnen (meine Profilfarbe)'), h('label', { class: 'toggle' }, assign, h('span')));
    const visHint = h('div', { class: 'hint' });
    const drawProvider = () => {
      steps.replaceChildren(...PROVIDERS[provider].steps.map((s) => h('li', null, s)));
      if (isNew && Object.values(PROVIDERS).some((p) => p.label === label.value)) label.value = PROVIDERS[provider].label;
    };
    const drawVis = () => {
      visHint.textContent = visibility === 'private' ? 'Die Termine sieht nur du.' : visibility === 'parents' ? 'Die Termine sehen nur die Eltern.' : 'Die ganze Familie sieht die Termine.';
      assignRow.hidden = visibility === 'private';
    };
    drawProvider(); drawVis();

    const save = h('button', { class: 'btn teal block', type: 'submit' }, isNew ? 'Verbinden' : 'Speichern');
    return h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (isNew && !url.value.trim()) { err.textContent = 'Bitte den Kalender-Link einfügen.'; err.hidden = false; return; }
        busy(save, true, 'Speichern …');
        try {
          await onSave({ provider, url: url.value.trim(), label: label.value.trim() || PROVIDERS[provider].label, visibility, assign_me: assign.checked, color });
          close();
        } catch (ex) { err.textContent = api.germanError(ex); err.hidden = false; busy(save, false); }
      },
    },
    err,
    isNew ? h('div', { class: 'field' }, h('label', null, 'Woher'),
      seg([['google', 'Google'], ['outlook', 'Outlook'], ['other', 'Anderer']], provider, (v) => { provider = v; drawProvider(); }, 'Anbieter')) : null,
    isNew ? h('div', { class: 'notice' }, icon('info', 20), h('div', null, h('strong', null, 'So findest du den Link'), steps)) : null,
    isNew ? field('Kalender-Link', url, 'Der Link ist privat: Er wird sicher gespeichert und ist für niemanden in der Familie sichtbar, auch nicht für dich.') : null,
    field('Name in Familienzeit', label),
    h('div', { class: 'field' }, h('label', null, 'Farbe'), colorPicker(color, (c) => { color = c; })),
    h('div', { class: 'field' }, h('label', null, 'Wer sieht die Termine'), seg(visOptions(), visibility, (v) => { visibility = v; drawVis(); }, 'Sichtbarkeit'), visHint),
    assignRow,
    isNew ? h('p', { class: 'muted small' }, 'Apple-Kalender (iCloud) bitte über „Kalenderdatei importieren“ übernehmen.') : null,
    save);
  };
}

function importCard(imp) {
  const edit = () => sheet('Kalender bearbeiten', (close) => {
    const name = h('input', { class: 'input', value: imp.name, maxlength: 60 });
    let color = imp.color;
    const save = h('button', { class: 'btn teal block', type: 'submit' }, 'Speichern');
    return h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        busy(save, true, 'Speichern …');
        try { await api.updateImport(imp.id, name.value.trim() || imp.name, color); close(); toast('Gespeichert.'); render(); }
        catch (ex) { toast(api.germanError(ex), { type: 'error' }); busy(save, false); }
      },
    }, field('Name', name), h('div', { class: 'field' }, h('label', null, 'Farbe'), colorPicker(color, (c) => { color = c; })), save);
  });
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('span', { class: 'cal-dot', style: { background: imp.color } }),
      h('h2', null, imp.name, ' ', h('span', { class: 'pill' }, 'Importiert'))),
    h('p', { class: 'muted small', style: { margin: '0 0 12px' } },
      `${imp.event_count} ${imp.event_count === 1 ? 'Termin' : 'Termine'} · importiert am ${new Date(imp.created_at).toLocaleDateString('de-DE')}`),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost small', onClick: edit }, 'Name und Farbe'),
      h('button', {
        class: 'btn danger small',
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Kalender entfernen?', text: `Alle aus „${imp.name}“ importierten Termine werden aus Familienzeit gelöscht, auch für die anderen.`, ok: 'Entfernen', danger: true }))) return;
          try { await api.deleteImport(imp.id); toast('Entfernt.'); render(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
        },
      }, 'Entfernen')));
}

export async function feedsView() {
  let feeds = [];
  let imports = [];
  try { [feeds, imports] = await Promise.all([api.listFeeds(), api.listImports()]); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
  const used = [...feeds.map((f) => f.color), ...imports.map((i) => i.color)];
  const root = h('div');
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (root.isConnected) render(); }, 8000); };

  const addSheet = () => sheet('Externen Kalender verbinden', feedForm({ usedColors: used }, async (v) => {
    await api.addFeed({ label: v.label, provider: v.provider, url: v.url, visibility: v.visibility, assignMe: v.assign_me, color: v.color });
    toast('Verbunden. Die Termine erscheinen in etwa einer Minute.');
    render();
  }));

  const card = (f) => {
    const sync = h('button', { class: 'btn ghost small' }, icon('repeat', 16), 'Jetzt abgleichen');
    sync.addEventListener('click', async () => {
      busy(sync, true, 'Angestoßen …');
      try { await api.requestFeedSync(f.id); toast('Abgleich angestoßen.'); later(); } catch (e) { toast(api.germanError(e), { type: 'error' }); busy(sync, false); }
    });
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('span', { class: 'cal-dot', style: { background: f.color } }),
        h('h2', null, f.label, ' ', h('span', { class: 'pill' }, PROVIDERS[f.provider]?.label || 'Kalender'))),
      h('p', { class: 'small', style: { margin: '0 0 6px' } }, statusOf(f)),
      h('p', { class: 'muted small', style: { margin: '0 0 12px' } },
        `Sichtbar für: ${VISIBILITY[f.visibility].label}`, f.visibility !== 'private' && f.assign_me ? ' · dir zugeordnet' : ''),
      h('div', { class: 'btn-row' },
        f.paused ? null : sync,
        h('button', {
          class: 'btn ghost small',
          onClick: async () => {
            try { await api.updateFeed({ ...f, paused: !f.paused }); toast(f.paused ? 'Fortgesetzt.' : 'Pausiert. Vorhandene Termine bleiben.'); render(); }
            catch (e) { toast(api.germanError(e), { type: 'error' }); }
          },
        }, f.paused ? 'Fortsetzen' : 'Pausieren'),
        h('button', {
          class: 'btn ghost small',
          onClick: () => sheet('Kalender bearbeiten', feedForm(f, async (v) => {
            await api.updateFeed({ ...f, label: v.label, visibility: v.visibility, assign_me: v.assign_me, color: v.color });
            toast('Gespeichert.'); render();
          })),
        }, 'Bearbeiten'),
        h('button', {
          class: 'btn danger small',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Verbindung beenden?', text: `„${f.label}“ wird getrennt. Alle daraus übernommenen Termine werden aus Familienzeit entfernt. Im Ursprungskalender bleibt alles erhalten.`, ok: 'Beenden', danger: true }))) return;
            try { await api.deleteFeed(f.id); toast('Verbindung beendet.'); render(); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
          },
        }, 'Beenden')));
  };

  if (feeds.some((f) => !f.paused && (!f.last_sync_at || f.sync_requested))) later();

  root.append(
    h('div', { class: 'hello' },
      h('button', { class: 'iconbtn', 'aria-label': 'Zurück', onClick: () => go('/kalender') }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { style: { fontSize: '1.35rem' } }, 'Meine Kalender'))),
    h('p', { class: 'muted small', style: { margin: '-8px 4px 14px' } },
      'Jeder Kalender hat eine eigene Farbe. Seine Termine erscheinen im Familienkalender in dieser Farbe – für alle, die sie sehen dürfen. Jeder verwaltet hier nur seine eigenen Kalender.'),
    h('div', { class: 'section-title' }, 'Abonniert (Google, Outlook …)'),
    ...(feeds.length ? feeds.map(card) : [h('div', { class: 'card', style: { textAlign: 'center' } },
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Noch kein externer Kalender verbunden. Termine werden etwa alle 30 Minuten übernommen – nur in diese Richtung.'))]),
    feeds.length < 5 ? h('button', { class: 'btn teal block', onClick: addSheet }, icon('plus', 18), 'Kalender verbinden') : null,
    h('div', { class: 'section-title' }, 'Importiert'),
    ...(imports.length ? imports.map(importCard) : [h('div', { class: 'card', style: { textAlign: 'center' } },
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Noch keine Kalenderdatei importiert.'))]),
    h('button', { class: 'btn ghost block', style: { marginBottom: '14px' }, onClick: () => go('/kalender-import') }, icon('download', 18), 'Kalenderdatei importieren'));
  return root;
}
