// App-Update: lädt eine Familienzeit-ZIP direkt aus der App ins GitHub-Repository.
// Der Zugangs-Token bleibt ausschließlich auf diesem Gerät.
import { h, icon, sheet, toast, field, busy, confirmDialog, passwordInput } from './dom.js';
import { APP_VERSION } from './config.js';
import { readZip } from './unzip.js';

const KEY = 'fz-github';
const DEFAULT_REPO = 'JAZM1309/Familienzeit';

export function loadCfg() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function saveCfg(cfg) {
  try { if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg)); else localStorage.removeItem(KEY); } catch { /* egal */ }
}

// ---------- GitHub-API ----------
export class GitHubError extends Error {
  constructor(status, body) { super(body); this.status = status; }
}

export async function gh(cfg, path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  return res.status === 204 ? null : res.json();
}

function ghMessage(e) {
  if (!navigator.onLine) return 'Keine Verbindung. Bitte Internet prüfen.';
  const body = String(e.message || '').toLowerCase();
  if (body.includes('workflow')) return 'Dem Token fehlt das Recht „Workflows: Read and write“.';
  if (e.status === 401) return 'Der Token ist ungültig oder abgelaufen. Bitte neu einrichten.';
  if (e.status === 403 || e.status === 404) return 'Kein Zugriff auf das Repository. Name und Rechte des Tokens prüfen (Contents: Read and write).';
  if (e.status === 409) return 'Das Repository ist leer oder der Branch fehlt.';
  if (e.status === 422) return 'GitHub hat die Änderung abgelehnt. Bitte noch einmal versuchen.';
  return 'GitHub-Fehler. Bitte später noch einmal versuchen.';
}

export const enc = (s) => s.split('/').map(encodeURIComponent).join('/');

// ---------- ZIP lesen ----------

// Pfade im Paket → Pfade im Repository
function mapPath(p) {
  if (p.startsWith('app/')) return p.slice(4);
  if (p.startsWith('supabase/') || p.startsWith('.github/')) return p;
  if (/^(index\.html|sw\.js|manifest\.webmanifest|(css|js|icons)\/.+)$/.test(p)) return p;
  return null; // Anleitung, Mac-Reste usw. werden nicht hochgeladen
}

async function readPackage(file) {
  if (!('DecompressionStream' in window)) throw new Error('Dieser Browser kann keine ZIP-Dateien entpacken. Bitte Chrome oder Safari aktualisieren.');
  const zip = await readZip(file);
  let names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX/') && !n.endsWith('.DS_Store'));

  // ZIP mit zusätzlichem Hauptordner, z. B. "Familienzeit-1.2/app/…"
  const firsts = new Set(names.map((n) => n.split('/')[0]));
  let prefix = '';
  if (firsts.size === 1 && names.every((n) => n.includes('/'))) {
    const only = [...firsts][0];
    if (!['app', 'supabase', '.github', 'css', 'js', 'icons'].includes(only)) prefix = only + '/';
  }

  const files = [];
  for (const n of names) {
    const target = mapPath(n.slice(prefix.length));
    if (target) files.push({ source: n, path: target });
  }
  const has = (p) => files.some((f) => f.path === p);
  if (!has('index.html') || !has('sw.js') || !has('manifest.webmanifest')) {
    throw new Error('Das ist keine Familienzeit-ZIP (index.html, sw.js oder Manifest fehlt).');
  }
  const manifest = JSON.parse(await zip.file(files.find((f) => f.path === 'manifest.webmanifest').source).async('string'));
  if (manifest.name !== 'Familienzeit') {
    throw new Error(`Diese ZIP gehört zu „${manifest.name || 'einer anderen App'}“, nicht zu Familienzeit.`);
  }
  const cfgFile = files.find((f) => f.path === 'js/config.js');
  const version = cfgFile ? (await zip.file(cfgFile.source).async('string')).match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1] : null;
  return { zip, files, version, migrations: files.filter((f) => f.path.startsWith('supabase/migrations/')).length };
}

// ---------- Hochladen als ein einziger Commit ----------
async function upload(cfg, pkg, onProgress) {
  const repo = enc(cfg.repo);
  const ref = await gh(cfg, `/repos/${repo}/git/ref/heads/${enc(cfg.branch)}`);
  const parent = await gh(cfg, `/repos/${repo}/git/commits/${ref.object.sha}`);

  const tree = [];
  let done = 0;
  const queue = [...pkg.files];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      const content = await pkg.zip.file(f.source).async('base64');
      const blob = await gh(cfg, `/repos/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      onProgress(++done, pkg.files.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const newTree = await gh(cfg, `/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree }) });
  const commit = await gh(cfg, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: `Familienzeit ${pkg.version || ''} über App-Update`.trim(), tree: newTree.sha, parents: [ref.object.sha] }),
  });
  await gh(cfg, `/repos/${repo}/git/refs/heads/${enc(cfg.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
}

// ---------- Oberfläche ----------
function setupSheet(onDone) {
  const cfg = loadCfg() || { repo: DEFAULT_REPO, branch: 'main', token: '' };
  sheet('GitHub einrichten', (close) => {
    const err = h('div', { class: 'error', role: 'alert', hidden: true });
    const repo = h('input', { class: 'input', value: cfg.repo, autocapitalize: 'off', spellcheck: 'false', placeholder: 'Besitzer/Repository' });
    const branch = h('input', { class: 'input', value: cfg.branch, autocapitalize: 'off', spellcheck: 'false' });
    const token = passwordInput({ autocomplete: 'off', minlength: null, placeholder: cfg.token ? 'gespeichert – leer lassen zum Beibehalten' : 'github_pat_…' });
    const save = h('button', { class: 'btn block', type: 'submit' }, 'Speichern und testen');
    return h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        const next = { repo: repo.value.trim(), branch: branch.value.trim() || 'main', token: token.input.value.trim() || cfg.token };
        if (!/^[\w.-]+\/[\w.-]+$/.test(next.repo)) { err.textContent = 'Repository bitte als „Besitzer/Name“ angeben.'; err.hidden = false; return; }
        if (!next.token) { err.textContent = 'Bitte den Token einfügen.'; err.hidden = false; return; }
        busy(save, true, 'Teste Verbindung …');
        try {
          const info = await gh(next, `/repos/${enc(next.repo)}`);
          if (info.permissions && !info.permissions.push) throw new GitHubError(403, 'no push');
          await gh(next, `/repos/${enc(next.repo)}/git/ref/heads/${enc(next.branch)}`);
          saveCfg(next);
          close();
          toast('GitHub ist verbunden.');
          onDone();
        } catch (ex) {
          err.textContent = ghMessage(ex);
          err.hidden = false;
          busy(save, false);
        }
      },
    },
    err,
    h('div', { class: 'notice' }, icon('info', 20), h('span', null,
      'Token anlegen: GitHub → Settings → Developer settings → Fine-grained tokens. Nur Zugriff auf dieses Repository, Rechte „Contents“, „Workflows“ und „Actions“ auf „Read and write“ (Actions nur für die Wiederherstellung). Der Token bleibt nur auf diesem Gerät.')),
    field('Repository', repo),
    field('Branch', branch),
    field('Token', token),
    save,
    cfg.token ? h('button', {
      type: 'button', class: 'btn danger block', style: { marginTop: '10px' },
      onClick: () => { saveCfg(null); close(); toast('GitHub-Verbindung entfernt.'); onDone(); },
    }, 'Verbindung trennen') : null);
  });
}

export function updateCard() {
  const card = h('section', { class: 'card' });
  const draw = () => {
    const cfg = loadCfg();
    const status = h('div', { class: 'muted small' });
    const progress = h('div', { class: 'progress', hidden: true }, h('span'));
    const fileInput = h('input', { type: 'file', accept: '.zip,application/zip', class: 'sr-only', 'aria-label': 'Update-ZIP auswählen' });
    const pick = h('label', { class: 'btn teal block' + (cfg ? '' : ' disabled'), 'aria-disabled': cfg ? null : 'true' },
      icon('download', 18), 'Update-ZIP auswählen', cfg ? fileInput : null);

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      let pkg;
      try { pkg = await readPackage(file); }
      catch (e) { toast(e.message || 'Die ZIP konnte nicht gelesen werden.', { type: 'error', duration: 6000 }); return; }

      const ok = await confirmDialog({
        title: `Version ${pkg.version || '?'} hochladen?`,
        text: `${pkg.files.length} Dateien werden ins Repository ${cfg.repo} geladen` +
          (pkg.migrations ? `, darunter ${pkg.migrations} Datenbank-Skript${pkg.migrations > 1 ? 'e' : ''}. Neue Skripte spielt GitHub danach automatisch in Supabase ein.` : '.') +
          ` Installiert ist gerade ${APP_VERSION}.`,
        ok: 'Hochladen',
      });
      if (!ok) return;

      pick.classList.add('disabled');
      progress.hidden = false;
      status.textContent = 'Wird hochgeladen …';
      try {
        await upload(cfg, pkg, (n, total) => {
          progress.firstChild.style.width = Math.round((n / total) * 100) + '%';
          status.textContent = `Datei ${n} von ${total} …`;
        });
        status.replaceChildren(
          `Version ${pkg.version || ''} ist hochgeladen. GitHub braucht 1–2 Minuten, danach meldet die App „Neue Version verfügbar“. `,
          h('a', { href: `https://github.com/${cfg.repo}/actions`, target: '_blank', rel: 'noopener noreferrer' }, 'Fortschritt auf GitHub'));
        toast('Update hochgeladen.');
      } catch (e) {
        status.textContent = ghMessage(e);
        toast(ghMessage(e), { type: 'error', duration: 6000 });
      }
      progress.hidden = true;
      pick.classList.remove('disabled');
    });

    status.textContent = cfg ? `Verbunden mit ${cfg.repo} (${cfg.branch}).` : 'GitHub ist auf diesem Gerät noch nicht eingerichtet.';
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', { class: 'card-icon' }, icon('download', 19)), h('h3', null, 'App-Update'),
        h('button', { class: 'btn ghost small', onClick: () => setupSheet(draw) }, cfg ? 'GitHub' : 'Einrichten')),
      h('p', { class: 'small', style: { marginTop: 0 } }, `Installierte Version: ${APP_VERSION}`),
      status, progress,
      h('div', { style: { marginTop: '12px' } }, pick));
  };
  draw();
  return card;
}
