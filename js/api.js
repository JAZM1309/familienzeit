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
  if (msg.includes('konflikt')) return 'Der Termin wurde inzwischen von jemand anderem geändert. Bitte neu öffnen und noch einmal versuchen.';
  if (msg.includes('keine berechtigung') || msg.includes('row-level security')) return 'Dafür fehlt dir die Berechtigung.';
  if (msg.includes('nur der ersteller')) return 'Nur wer den Termin erstellt hat, kann die Sichtbarkeit ändern.';
  if (msg.includes('eltern-terminen')) return 'Kinder können nicht zu „Nur Eltern“-Terminen zugeordnet werden.';
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

// ---------- Kalender (ab Version 1.1) ----------
const EVENT_SELECT = '*, event_participants(user_id), event_exceptions(*), event_reminders(offsets)';

export async function eventsInRange(from, to) {
  return check(await sb.rpc('events_in_range', { p_from: from.toISOString(), p_to: to.toISOString() })
    .select(EVENT_SELECT));
}

export async function loadEvent(id) {
  return check(await sb.from('events').select(EVENT_SELECT).eq('id', id).maybeSingle());
}

export async function saveEvent({ id, version, data, participants, reminders }) {
  return check(await sb.rpc('save_event', {
    p_id: id || null, p_version: version ?? null, p_data: data,
    p_participants: participants, p_reminders: reminders,
  }));
}

export async function deleteEvent(id) {
  return check(await sb.from('events').delete().eq('id', id));
}

export async function saveException(row) {
  return check(await sb.from('event_exceptions').upsert(row, { onConflict: 'event_id,original_start' }));
}

export async function eventHistory(id) {
  return check(await sb.from('event_history').select('*').eq('event_id', id).order('at', { ascending: false }));
}

export async function clearExceptions(eventId) {
  return check(await sb.from('event_exceptions').delete().eq('event_id', eventId));
}

// ---------- Benachrichtigungen (ab Version 1.2) ----------
export async function pushPublicKey() {
  return check(await sb.rpc('push_public_key'));
}

export async function registerPush(sub, label) {
  const j = sub.toJSON();
  return check(await sb.rpc('register_push', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: label,
  }));
}

export async function unregisterPush(endpoint) {
  return check(await sb.rpc('unregister_push', { p_endpoint: endpoint }));
}

export async function sendTestPush() {
  return check(await sb.rpc('send_test_push'));
}

export async function listNotifications(limit = 100) {
  return check(await sb.from('notifications')
    .select('id, type, title, body, url, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(limit));
}

export async function unreadCount() {
  const { count, error } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  if (error) throw error;
  return count || 0;
}

export async function markRead(ids) {
  if (!ids.length) return;
  return check(await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids));
}

export async function markAllRead() {
  return check(await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null));
}

export async function deleteReadNotifications() {
  return check(await sb.from('notifications').delete().not('read_at', 'is', null));
}
