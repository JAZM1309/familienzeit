// Wiederherstellung aus der App: startet den GitHub-Ablauf „Wiederherstellung“
// über die GitHub-Verbindung des App-Updates und zeigt den Fortschritt an.
import { h, icon, sheet, toast, field, busy, confirmDialog } from './dom.js';
import { state } from './app.js';
import { loadCfg, gh, enc } from './updater.js';
import { lockEnabled, verify } from './lock.js';
import { toDateInput } from './dates.js';

const WORKFLOW = 'wiederherstellung.yml';
const PENDING = 'fz-restore-pending';

const STEP_HELP = {
  'Eingaben prüfen': 'Bestätigung oder ein Secret fehlt.',
  'Sicherung auswählen': 'Zu dieser Angabe gibt es keine Sicherung – oder BACKUP_TOKEN hat keinen Zugriff auf das Sicherungs-Repository.',
  'Sicherung holen und entschlüsseln': 'Entschlüsseln fehlgeschlagen – stimmt BACKUP_PASSWORD?',
  'Probelauf in einer leeren Testdatenbank': 'Die Sicherung ließ sich nicht einspielen. Details im Bericht auf GitHub.',
  'Echte Wiederherstellung': 'Abgebrochen – die Datenbank ist unverändert. Details im Bericht auf GitHub.',
};

function message(e) {
  if (!navigator.onLine) return 'Keine Verbindung. Bitte Internet prüfen.';
  if (e.status === 401) return 'Der GitHub-Token ist ungültig oder abgelaufen. Bitte unter „App-Update“ neu einrichten.';
  if (e.status === 403) return 'Dem GitHub-Token fehlt das Recht „Actions: Read and write“. GitHub → Settings → Developer settings → Fine-grained tokens → Token bearbeiten → Permissions → Actions: Read and write → Update.';
  if (e.status === 404) return 'Der Ablauf „Wiederherstellung“ wurde nicht gefunden. Ist Version 1.9.0 hochgeladen?';
  if (e.status === 422) return 'GitHub hat den Start abgelehnt. Bitte noch einmal versuchen.';
  return 'GitHub-Fehler. Bitte später noch einmal versuchen.';
}

function loadPending() { try { return JSON.parse(localStorage.getItem(PENDING) || 'null'); } catch { return null; } }
function savePending(v) { try { if (v) localStorage.setItem(PENDING, JSON.stringify(v)); else localStorage.removeItem(PENDING); } catch { /* egal */ } }

async function listRuns(cfg) {
  const r = await gh(cfg, `/repos/${enc(cfg.repo)}/actions/workflows/${WORKFLOW}/runs?per_page=5`);
  return r.workflow_runs || [];
}

async function failedStep(cfg, run) {
  try {
    const r = await gh(cfg, `/repos/${enc(cfg.repo)}/actions/runs/${run.id}/jobs?filter=latest`);
    for (const job of r.jobs || []) {
      const step = (job.steps || []).find((s) => s.conclusion === 'failure');
      if (step) return step.name;
      if (job.conclusion === 'failure') return job.name;
    }
  } catch { /* egal */ }
  return null;
}

async function dispatch(cfg, inputs) {
  const started = Date.now();
  await gh(cfg, `/repos/${enc(cfg.repo)}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST', body: JSON.stringify({ ref: cfg.branch, inputs }),
  });
  savePending({ at: started, modus: inputs.modus });
}

const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function runRow(run, extra) {
  const done = run.status === 'completed';
  const ok = run.conclusion === 'success';
  const label = !done ? (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending' ? 'wartet …' : 'läuft …')
    : ok ? 'erfolgreich' : run.conclusion === 'cancelled' ? 'abgebrochen' : 'fehlgeschlagen';
  const ic = !done ? 'clock' : ok ? 'check' : 'x';
  const title = (run.display_title || '').replace(/^Wiederherstellung\s*[–-]\s*/, '') || 'Wiederherstellung';
  return h('a', { class: 'rs-run ' + (!done ? 'busy' : ok ? 'ok' : 'bad'), href: run.html_url, target: '_blank', rel: 'noopener noreferrer' },
    h('span', { class: 'rs-ic' }, icon(ic, 16)),
    h('span', { class: 'rs-main' },
      h('strong', null, title),
      h('span', null, `${fmt(run.created_at)} · ${label}`),
      extra ? h('span', { class: 'rs-hint' }, extra) : null),
    icon('link', 15));
}

function restoreSheet(cfg, onStarted) {
  sheet('Daten wiederherstellen', (close) => {
    const err = h('div', { class: 'error', role: 'alert', hidden: true });
    let which = 'neueste';
    const date = h('input', { class: 'input', type: 'date', max: toDateInput(new Date()), hidden: true });
    const choice = h('div', { class: 'seg', role: 'group', 'aria-label': 'Welche Sicherung' },
      [['neueste', 'Neueste'], ['datum', 'Datum'], ['rückgängig', 'Rückgängig']].map(([v, l]) => h('button', {
        type: 'button', 'aria-pressed': String(v === which),
        onClick: (e) => {
          which = v;
          for (const b of choice.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          date.hidden = v !== 'datum';
          hint.textContent = HINTS[v];
        },
      }, l)));
    const HINTS = {
      neueste: 'Die letzte Sonntags-Sicherung.',
      datum: 'Die Sicherung von einem bestimmten Sonntag.',
      'rückgängig': 'Der Stand direkt vor der letzten Wiederherstellung.',
    };
    const hint = h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, HINTS[which]);
    const konten = h('input', { type: 'checkbox' });
    const confirmInput = h('input', { class: 'input', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: 'WIEDERHERSTELLEN' });
    const go = h('button', { class: 'btn danger block', type: 'submit' }, icon('repeat', 18), 'Wiederherstellung starten');

    return h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        const sel = which === 'datum' ? date.value : which;
        if (!sel) { err.textContent = 'Bitte ein Datum wählen.'; err.hidden = false; return; }
        if (confirmInput.value.trim().toUpperCase() !== 'WIEDERHERSTELLEN') {
          err.textContent = 'Bitte zur Bestätigung WIEDERHERSTELLEN eintippen.'; err.hidden = false; return;
        }
        try { if (lockEnabled(state.me.user_id)) await verify(state.me.user_id); }
        catch { err.textContent = 'Die Bestätigung per Fingerabdruck/Gesicht wurde abgebrochen.'; err.hidden = false; return; }
        busy(go, true, 'Wird gestartet …');
        try {
          await dispatch(cfg, { sicherung: sel, modus: 'Echt', konten: String(konten.checked), bestaetigung: 'WIEDERHERSTELLEN' });
          close();
          toast('Wiederherstellung gestartet. Bitte die Familie bitten, die App kurz zu schließen.', { duration: 6000 });
          onStarted();
        } catch (ex) {
          err.textContent = message(ex); err.hidden = false; busy(go, false);
        }
      },
    },
    h('div', { class: 'notice warn' }, icon('info', 20), h('span', null,
      'Alle Familiendaten werden durch die Sicherung ersetzt. Vorher wird der aktuelle Stand automatisch gesichert – mit „Rückgängig“ kommst du dorthin zurück. Fotos und Anhänge sind nicht Teil der Sicherung.')),
    err,
    field('Welche Sicherung?', h('div', null, choice, date, hint)),
    h('label', { class: 'rs-check' }, konten, h('span', null,
      h('strong', null, 'Fehlende Konten ergänzen'),
      h('span', { class: 'muted small' }, 'Nur nötig, wenn Konten verloren gegangen sind. Bestehende Konten werden nie verändert.'))),
    field('Zur Bestätigung WIEDERHERSTELLEN eintippen', confirmInput),
    go);
  });
}

export function restoreCard() {
  const card = h('section', { class: 'card' });
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };

  const draw = async () => {
    stop();
    const cfg = loadCfg();
    const head = h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('repeat', 19)), h('h3', null, 'Wiederherstellung'));
    const intro = h('p', { class: 'muted small', style: { marginTop: 0 } },
      'Startet die Abläufe auf GitHub. Der Probelauf prüft die neueste Sicherung in einer Testdatenbank – deine App bleibt dabei unberührt.');
    if (!cfg) {
      card.replaceChildren(head, intro, h('p', { class: 'small' }, 'Zuerst unter „App-Update“ GitHub einrichten.'));
      return;
    }
    const list = h('div', { class: 'rs-list' }, h('p', { class: 'muted small' }, 'Lade letzte Läufe …'));
    const probe = h('button', { class: 'btn teal block' }, icon('check', 18), 'Probelauf starten');
    const real = h('button', { class: 'btn danger block', style: { marginTop: '10px' } }, icon('repeat', 18), 'Wiederherstellen …');
    probe.addEventListener('click', async () => {
      busy(probe, true, 'Wird gestartet …');
      try {
        await dispatch(cfg, { sicherung: 'neueste', modus: 'Probelauf', konten: 'false', bestaetigung: '' });
        toast('Probelauf gestartet. Dauert etwa 2–3 Minuten.');
        draw();
      } catch (e) { toast(message(e), { type: 'error', duration: 9000 }); busy(probe, false); }
    });
    real.addEventListener('click', () => restoreSheet(cfg, draw));
    card.replaceChildren(head, intro, list, probe, real);

    try {
      const runs = await listRuns(cfg);
      const pending = loadPending();
      // Gestarteter Lauf taucht bei GitHub erst nach einigen Sekunden auf
      const waiting = pending && !runs.some((r) => new Date(r.created_at).getTime() >= pending.at - 10000);
      if (pending && !waiting && runs[0]?.status === 'completed') savePending(null);
      if (pending && Date.now() - pending.at > 30 * 60000) savePending(null);
      const rows = [];
      if (waiting) rows.push(h('div', { class: 'rs-run busy' }, h('span', { class: 'rs-ic' }, icon('clock', 16)),
        h('span', { class: 'rs-main' }, h('strong', null, pending.modus), h('span', null, 'wird gestartet …'))));
      for (const run of runs.slice(0, 3)) {
        let extra = null;
        if (run.status === 'completed' && run.conclusion === 'failure') {
          const step = await failedStep(cfg, run);
          extra = (step && STEP_HELP[step]) || 'Details im Bericht auf GitHub.';
        }
        rows.push(runRow(run, extra));
      }
      list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'muted small' }, 'Noch keine Läufe.')]));
      if (rows.length) list.append(h('p', { class: 'muted small', style: { margin: '6px 0 12px' } }, 'Antippen öffnet den ausführlichen Bericht auf GitHub.'));
      const active = waiting || runs.some((r) => r.status !== 'completed');
      if (active) {
        timer = setTimeout(() => { if (card.isConnected) draw(); }, 8000);
        probe.disabled = true; real.disabled = true;
      }
    } catch (e) {
      list.replaceChildren(h('p', { class: 'error small' }, message(e)));
    }
  };
  draw();
  return card;
}
