// Version 1.8: Speicheranzeige und Datenexport (ZIP mit JSON, CSV und Dateien)
import { h, icon, toast, busy, sheet } from './dom.js';
import { readZip } from './unzip.js';
import * as api from './api.js';
import { state, isAdmin } from './app.js';
import { ZipWriter } from './zip.js';
import { VISIBILITY } from './events.js';

const MB = 1024 * 1024;
const fmtSize = (b) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(2).replace('.', ',')} GB` : `${Math.max(0.1, b / MB).toFixed(1).replace('.', ',')} MB`);

export async function usage() {
  try { return await api.usageStats(); } catch { return null; }
}

function bar(label, used, limit) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone = pct >= 95 ? 'var(--danger)' : pct >= 80 ? 'var(--orange)' : 'var(--teal)';
  return h('div', { class: 'usage' },
    h('div', { class: 'usage-head' }, h('span', null, label), h('span', { class: 'muted small' }, `${fmtSize(used)} von ${fmtSize(limit)} · ${pct} %`)),
    h('div', { class: 'progress', style: { marginTop: '6px' } }, h('span', { style: { width: pct + '%', background: tone } })));
}

// Warnkarte für die Startseite des Administrators (ab 80 %)
export async function usageWarning() {
  if (!isAdmin()) return null;
  const u = await usage();
  if (!u) return null;
  const s = u.storage_bytes / u.storage_limit;
  const d = u.db_bytes / u.db_limit;
  if (Math.max(s, d) < 0.8) return null;
  return h('section', { class: 'card warn-card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('info', 19)), h('h2', null, 'Speicher fast voll')),
    h('p', { class: 'small', style: { margin: 0 } },
      u.uploads_blocked
        ? 'Neue Fotos und Anhänge sind gesperrt, bis wieder Platz frei ist. Alte Anhänge oder Bilder löschen schafft Platz.'
        : `Der kostenlose Speicher ist zu ${Math.round(Math.max(s, d) * 100)} % belegt. Ab 95 % sind neue Fotos und Anhänge gesperrt.`));
}

// ---------- Export ----------
const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function csv(rows, cols) {
  return '﻿' + [cols.map(([, label]) => label).join(';'), ...rows.map((r) => cols.map(([k]) => csvCell(typeof k === 'function' ? k(r) : r[k])).join(';'))].join('\r\n');
}
const de = (v) => (v ? new Date(v).toLocaleString('de-DE') : '');
const safe = (s) => String(s || 'datei').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 80);

// Dateiname im Export – auch für das Wiedererkennen älterer Exporte ohne dateien.json
function expectedName(kind, label, path) {
  if (kind === 'anhang') return `dateien/anhaenge/${safe(label)}`;
  if (kind === 'essen') return `dateien/essen/${safe(label)}.${String(path).split('.').pop()}`;
  return `dateien/profile/${safe(label)}.webp`;
}

const MIME = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', gif: 'image/gif' };

// ---------- Fotos und Anhänge aus einem Export wiederherstellen ----------
// Ordnet fehlenden Dateien die passenden Dateien im ZIP zu
export function matchFiles(missing, zipNames, manifest) {
  const names = new Set(zipNames);
  const out = [];
  if (manifest) {
    const byPath = new Map(manifest.map((m) => [m.pfad, m.datei]));
    for (const f of missing) {
      const d = byPath.get(f.path);
      out.push({ ...f, datei: d && names.has(d) ? d : null });
    }
    return out;
  }
  // Ältere Exporte: über den Dateinamen; gleiche Namen wurden beim Export „x (2)“, „x (3)“ … genannt
  const groups = new Map();
  for (const f of missing) {
    const base = expectedName(f.kind, f.label, f.path);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(f);
  }
  for (const [base, list] of groups) {
    list.forEach((f, i) => {
      const cand = i === 0 ? base : base.replace(/(\.[^./]+)?$/, ` (${i + 1})$1`);
      out.push({ ...f, datei: names.has(cand) ? cand : null, unsicher: list.length > 1 });
    });
  }
  return out;
}

function restoreFilesSheet(onDone) {
  sheet('Fotos und Anhänge wiederherstellen', (close) => {
    const body = h('div', null, h('p', { class: 'muted' }, 'Prüfe, welche Dateien fehlen …'));
    (async () => {
      let missing;
      try { missing = await api.missingFiles(); } catch (e) { body.replaceChildren(h('p', { class: 'error' }, api.germanError(e))); return; }
      if (!missing.length) {
        body.replaceChildren(h('div', { class: 'soon' }, icon('check', 16), 'Es fehlen keine Fotos oder Anhänge. Alles ist vollständig.'));
        return;
      }
      const count = (k) => missing.filter((f) => f.kind === k).length;
      const parts = [[count('anhang'), 'Anhang', 'Anhänge'], [count('essen'), 'Essensbild', 'Essensbilder'], [count('profil'), 'Profilbild', 'Profilbilder']]
        .filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(', ');
      const input = h('input', { type: 'file', accept: '.zip,application/zip', class: 'sr-only', 'aria-label': 'Export-ZIP auswählen' });
      const status = h('div');
      body.replaceChildren(
        h('p', { style: { marginTop: 0 } }, h('strong', null, `${missing.length} ${missing.length === 1 ? 'Datei fehlt' : 'Dateien fehlen'}`), ` (${parts}).`),
        h('p', { class: 'muted small' }, 'Wähle einen Familienzeit-Export (ZIP) aus. Nur Dateien, die wirklich fehlen, werden hochgeladen – vorhandene bleiben unverändert.'),
        h('label', { class: 'btn teal block' }, icon('download', 18), 'Export-ZIP auswählen', input),
        status);

      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        status.replaceChildren(h('p', { class: 'muted small' }, 'ZIP wird gelesen …'));
        let zip;
        try { zip = await readZip(file); } catch { status.replaceChildren(h('p', { class: 'error' }, 'Die ZIP-Datei lässt sich nicht lesen.')); return; }
        const zipNames = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
        if (!zipNames.some((n) => n.startsWith('dateien/'))) {
          status.replaceChildren(h('p', { class: 'error' }, 'Das ist kein Familienzeit-Export mit Dateien (Ordner „dateien“ fehlt).'));
          return;
        }
        let manifest = null;
        try { if (zip.file('dateien.json')) manifest = JSON.parse(await zip.file('dateien.json').async('string')); } catch { manifest = null; }
        const plan = matchFiles(missing, zipNames, manifest);
        const found = plan.filter((p) => p.datei);
        const notFound = plan.length - found.length;
        const go = h('button', { class: 'btn block', style: { marginTop: '12px' }, disabled: !found.length }, icon('repeat', 18),
          found.length ? `${found.length} ${found.length === 1 ? 'Datei' : 'Dateien'} hochladen` : 'Nichts zum Hochladen');
        status.replaceChildren(...[
          h('div', { class: 'ics-count' }, `${found.length} von ${plan.length} fehlenden Dateien im Export gefunden.`),
          notFound ? h('p', { class: 'muted small' }, `${notFound} ${notFound === 1 ? 'Datei ist' : 'Dateien sind'} nicht in diesem Export – vielleicht in einem älteren oder neueren.`) : null,
          !manifest && plan.some((p) => p.unsicher && p.datei)
            ? h('p', { class: 'muted small' }, 'Hinweis: Dieser Export ist älter. Dateien mit gleichem Namen werden in der Reihenfolge zugeordnet, in der sie angelegt wurden.') : null,
          go].filter(Boolean));
        go.addEventListener('click', async () => {
          const progress = h('div', { class: 'progress' }, h('span'));
          const line = h('p', { class: 'muted small' });
          status.replaceChildren(progress, line);
          let ok = 0; let failed = 0; let lastErr = '';
          for (let i = 0; i < found.length; i++) {
            const f = found[i];
            line.textContent = `Datei ${i + 1} von ${found.length} …`;
            try {
              const ext = String(f.path).split('.').pop().toLowerCase();
              const type = f.mime || MIME[ext] || 'application/octet-stream';
              const data = await zip.file(f.datei).async();
              await api.restoreFile(f.path, new Blob([data], { type }), type);
              ok++;
            } catch (e) { failed++; lastErr = e.message || api.germanError(e); }
            progress.firstChild.style.width = Math.round(((i + 1) / found.length) * 100) + '%';
          }
          status.replaceChildren(...[
            h('div', { class: 'ics-count' }, `${ok} ${ok === 1 ? 'Datei' : 'Dateien'} wiederhergestellt.`),
            failed ? h('p', { class: 'error' }, `${failed} fehlgeschlagen: ${lastErr}`) : null,
            notFound ? h('p', { class: 'muted small' }, `${notFound} weiterhin fehlend.`) : null,
            h('button', { class: 'btn ghost block', style: { marginTop: '12px' }, onClick: () => { close(); onDone?.(); } }, 'Fertig')].filter(Boolean));
          toast(`${ok} Dateien wiederhergestellt.`);
        });
      });
    })();
    return body;
  });
}

async function exportZip(onStep) {
  const name = (id) => state.members.find((m) => m.user_id === id)?.display_name || '';
  const zip = new ZipWriter();
  onStep('Termine …');
  const events = await api.fetchAll('events', '*, event_participants(user_id), event_exceptions(*)');
  onStep('Aufgaben …');
  const tasks = await api.fetchAll('tasks', '*, task_assignees(user_id)');
  onStep('Kommentare …');
  const comments = await api.fetchAll('comments', '*');
  const attachments = await api.fetchAll('attachments', '*');
  onStep('Essen und Einkauf …');
  const meals = await api.fetchAll('meal_wishes', '*, meal_likes(user_id)');
  const shopping = await api.fetchAll('shopping_items', '*');

  const stamp = new Date().toISOString().slice(0, 10);
  const members = state.members.map((m) => ({ name: m.display_name, rolle: m.role, email: m.email, farbe: m.color, beigetreten: m.joined_at }));
  zip.add('LIESMICH.txt', [
    `Familienzeit – Datenexport vom ${new Date().toLocaleString('de-DE')}`,
    `Familie: ${state.family.name}`, `Erstellt von: ${state.me.display_name}`, '',
    'Enthalten ist alles, was das exportierende Konto sehen darf.',
    'Persönliche Termine anderer Familienmitglieder sind deshalb absichtlich NICHT enthalten.', '',
    'JSON-Dateien: vollständige Daten. CSV-Dateien: für Excel (Trennzeichen Semikolon).',
    'Ordner "dateien": Anhänge, Essensbilder und Profilbilder.',
    'dateien.json: Zuordnung der Dateien – damit kann Familienzeit sie später wiederherstellen.',
  ].join('\r\n'));
  zip.add('familie.json', JSON.stringify({ familie: state.family.name, mitglieder: members }, null, 2));
  zip.add('termine.json', JSON.stringify(events, null, 2));
  zip.add('termine.csv', csv(events, [
    ['title', 'Titel'], [(e) => de(e.starts_at), 'Beginn'], [(e) => de(e.ends_at), 'Ende'], [(e) => (e.all_day ? 'ja' : 'nein'), 'Ganztägig'],
    ['location', 'Ort'], ['description', 'Beschreibung'], [(e) => VISIBILITY[e.visibility]?.label, 'Sichtbarkeit'],
    [(e) => (e.event_participants || []).map((p) => name(p.user_id)).join(', ') || 'Familie', 'Wer'],
    ['rrule', 'Wiederholung'], ['until', 'Bis'], [(e) => name(e.owner_id), 'Erstellt von'],
    [(e) => (e.feed_id ? 'Abo' : e.source === 'ics' ? 'Import' : 'Familienzeit'), 'Herkunft'],
  ]));
  zip.add('aufgaben.json', JSON.stringify(tasks, null, 2));
  zip.add('aufgaben.csv', csv(tasks, [
    ['title', 'Titel'], ['description', 'Beschreibung'], ['status', 'Status'], ['priority', 'Priorität'], [(t) => de(t.due_at), 'Fällig'],
    [(t) => (t.task_assignees || []).map((a) => name(a.user_id)).join(', ') || 'Familie', 'Wer'], [(t) => name(t.owner_id), 'Erstellt von'],
    [(t) => de(t.done_at), 'Erledigt am'],
  ]));
  zip.add('kommentare.json', JSON.stringify(comments, null, 2));
  zip.add('essenswuensche.json', JSON.stringify(meals, null, 2));
  zip.add('essenswuensche.csv', csv(meals, [
    ['title', 'Gericht'], ['description', 'Beschreibung'], ['ingredients', 'Zutaten'], ['recipe', 'Rezept'], ['recipe_url', 'Rezeptlink'],
    [(m) => name(m.owner_id), 'Gewünscht von'], [(m) => (m.meal_likes || []).length, 'Likes'], [(m) => (m.cooked ? 'ja' : 'nein'), 'Gekocht'],
  ]));
  zip.add('einkaufsliste.csv', csv(shopping, [
    ['name', 'Artikel'], ['quantity', 'Menge'], ['unit', 'Einheit'], ['category', 'Kategorie'], [(i) => (i.done ? 'ja' : 'nein'), 'Erledigt'],
    [(i) => name(i.added_by), 'Hinzugefügt von'],
  ]));

  // Dateien
  const files = [
    ...attachments.map((a) => ({ path: a.storage_path, out: expectedName('anhang', a.file_name, a.storage_path), kind: 'anhang' })),
    ...meals.filter((m) => m.image_path).map((m) => ({ path: m.image_path, out: expectedName('essen', m.title, m.image_path), kind: 'essen' })),
    ...state.members.filter((m) => m.avatar_path).map((m) => ({ path: m.avatar_path, out: expectedName('profil', m.display_name, m.avatar_path), kind: 'profil' })),
  ];
  const manifest = [];
  const used = new Set();
  const unique = (p) => { let q = p; let i = 2; while (used.has(q)) q = p.replace(/(\.[^.]+)?$/, ` (${i++})$1`); used.add(q); return q; };
  for (let i = 0; i < files.length; i += 50) {
    const chunk = files.slice(i, i + 50);
    const urls = await api.signedUrls(chunk.map((f) => f.path));
    for (const f of chunk) {
      onStep(`Dateien ${Math.min(files.length, used.size + 1)} von ${files.length} …`);
      const u = urls[f.path];
      if (!u) continue;
      try {
        const r = await fetch(u);
        if (r.ok) { const name = unique(f.out); zip.add(name, await r.arrayBuffer()); manifest.push({ datei: name, pfad: f.path, art: f.kind }); }
      } catch { /* Datei überspringen */ }
    }
  }
  zip.add('dateien.json', JSON.stringify(manifest, null, 2));
  onStep('ZIP wird erstellt …');
  return { blob: zip.blob(), fileName: `familienzeit-export-${stamp}.zip` };
}

export function backupCard() {
  const card = h('section', { class: 'card' });
  const draw = async () => {
    const u = await usage();
    const status = h('p', { class: 'muted small', style: { margin: '10px 0 0' } });
    const btn = h('button', { class: 'btn ghost block', style: { marginTop: '14px' } }, icon('download', 18), 'Daten exportieren (ZIP)');
    btn.addEventListener('click', async () => {
      busy(btn, true, 'Export läuft …');
      try {
        const { blob, fileName } = await exportZip((t) => { status.textContent = t; });
        const a = h('a', { href: URL.createObjectURL(blob), download: fileName });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        status.textContent = `Fertig: ${fileName} (${fmtSize(blob.size)}).`;
        toast('Export erstellt.');
      } catch (e) {
        status.textContent = '';
        toast(api.germanError(e), { type: 'error' });
      }
      busy(btn, false);
    });
    card.replaceChildren(...[
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('shield', 19)), h('h3', null, 'Speicher und Datensicherung')),
      u ? bar('Dateien (Fotos, Anhänge)', u.storage_bytes, u.storage_limit) : null,
      u ? bar('Datenbank', u.db_bytes, u.db_limit) : null,
      u ? h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, `${u.file_count} Dateien gespeichert. Ab 95 % sind neue Uploads gesperrt.`)
        : h('p', { class: 'muted small' }, 'Der Verbrauch kann gerade nicht geladen werden.'),
      btn, status,
      h('button', { class: 'btn ghost block', style: { marginTop: '10px' }, onClick: () => restoreFilesSheet(draw) },
        icon('repeat', 18), 'Fotos und Anhänge wiederherstellen'),
      h('p', { class: 'muted small', style: { margin: '10px 0 0' } },
        'Der Export enthält alles, was du sehen darfst – persönliche Termine anderer sind nicht dabei. Zusätzlich sichert GitHub die Datenbank jeden Sonntag verschlüsselt. Fotos und Anhänge sind nur im Export enthalten – ihn also ab und zu erstellen und aufbewahren.')].filter(Boolean));
  };
  draw();
  return card;
}
