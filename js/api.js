// Alle Zugriffe auf Supabase. Die Rechte prüft die Datenbank (RLS),
// diese Datei ruft nur auf.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

if (!window.supabase?.createClient) {
  throw new Error('supabase-lib-missing');
}

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const BUCKET = 'familie';

// Fehlermeldungen verständlich auf Deutsch
export function germanError(err) {
  const msg = (err?.message || String(err || '')).toLowerCase();
  if (!navigator.onLine || msg.includes('failed to fetch') || msg.includes('network')) return 'Keine Verbindung. Bitte Internet prüfen.';
  if (msg.includes('invalid login credentials')) return 'E-Mail oder Passwort ist falsch.';
  if (msg.includes('email not confirmed')) return 'Die E-Mail-Adresse ist noch nicht bestätigt.';
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'Diese E-Mail-Adresse hat bereits ein Konto.';
  if (msg.includes('database error saving new user')) return 'Registrierung nicht möglich. Die Einladung ist eventuell abgelaufen oder schon benutzt.';
  if (msg.includes('password should be') || msg.includes('weak password')) return 'Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen.';
  if (msg.includes('same_password') || msg.includes('different from the old')) return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Zu viele Versuche. Bitte kurz warten.';
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  if (msg.includes('kein platz')) return 'Für diese Rolle ist kein Platz mehr frei.';
  if (msg.includes('nur der administrator')) return 'Das darf nur der Administrator.';
  if (msg.includes('payload too large') || msg.includes('maximum allowed size')) return 'Die Datei ist zu groß.';
  if (msg.includes('jwt') || msg.includes('not authenticated')) return 'Sitzung abgelaufen. Bitte neu anmelden.';
  return 'Das hat nicht geklappt. Bitte noch einmal versuchen.';
}

function check({ data, error }) {
  if (error) throw error;
  return data;
}

// ---------- Anmeldung ----------
export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  return check(await sb.auth.signInWithPassword({ email: email.trim(), password }));
}

export async function signUp({ email, password, displayName, familyName, inviteToken }) {
  const meta = { display_name: displayName.trim() };
  if (familyName) meta.family_name = familyName.trim();
  if (inviteToken) meta.invite_token = inviteToken;
  return check(await sb.auth.signUp({ email: email.trim(), password, options: { data: meta } }));
}

export async function signOut() {
  await sb.auth.signOut({ scope: 'local' });
}

export async function changePassword(password) {
  return check(await sb.auth.updateUser({ password }));
}

// ---------- Start ohne Familie / Einladungen ----------
export async function setupOpen() {
  return check(await sb.rpc('setup_open'));
}

export async function checkInvitation(token) {
  const rows = check(await sb.rpc('check_invitation', { p_token: token }));
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function createInvitation(role) {
  const rows = check(await sb.rpc('create_invitation', { p_role: role }));
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function revokeInvitation(id) {
  return check(await sb.rpc('revoke_invitation', { p_id: id }));
}

export async function openInvitations() {
  return check(await sb.from('invitations')
    .select('id, role, created_at, expires_at')
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true }));
}

// ---------- Familie und Profile ----------
export async function loadFamily() {
  const [family, members] = await Promise.all([
    sb.from('families').select('id, name, admin_id').maybeSingle().then(check),
    sb.from('members').select('*').order('joined_at', { ascending: true }).then(check),
  ]);
  return { family, members };
}

export async function updateFamilyName(id, name) {
  return check(await sb.from('families').update({ name: name.trim() }).eq('id', id));
}

export async function updateMe(userId, patch) {
  return check(await sb.from('members').update(patch).eq('user_id', userId));
}

// ---------- Profilbilder ----------
export function avatarPath(familyId, userId) {
  return `${familyId}/avatars/${userId}.webp`;
}

export async function uploadAvatar(familyId, userId, blob) {
  const path = avatarPath(familyId, userId);
  check(await sb.storage.from(BUCKET).upload(path, blob, {
    upsert: true, contentType: blob.type, cacheControl: '3600',
  }));
  return path;
}

export async function removeAvatar(path) {
  await sb.storage.from(BUCKET).remove([path]);
}

// Zeitlich begrenzte Links zu privaten Bildern (1 Stunde)
export async function signedUrls(paths) {
  if (!paths.length) return {};
  const rows = check(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600));
  const out = {};
  for (const r of rows || []) if (r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}
