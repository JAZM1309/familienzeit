// Alle Zugriffe auf Supabase. Die Rechte prüft die Datenbank (RLS),
// diese Datei ruft nur auf.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { cached, cacheGet, cacheSet, enqueue, isNetworkError, registerHandler } from './offline.js';

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
  if (msg.includes('konflikt')) return 'Der Eintrag wurde inzwischen von jemand anderem geändert. Bitte neu öffnen und noch einmal versuchen.';
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
  return cached('family', async () => {
    const [family, members] = await Promise.all([
      sb.from('families').select('id, name, admin_id').maybeSingle().then(check),
      sb.from('members').select('*').order('joined_at', { ascending: true }).then(check),
    ]);
    return { family, members };
  });
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
  if (!paths.length || !navigator.onLine) return {};
  const rows = check(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600));
  const out = {};
  for (const r of rows || []) if (r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}

// ---------- Kalender (ab Version 1.1) ----------
const EVENT_SELECT = '*, event_participants(user_id), event_exceptions(*), event_reminders(offsets)';

// Offline-Zwischenspeicher: alle zuletzt geladenen Termine nach ID
function inRange(e, from, to) {
  if (new Date(e.starts_at) >= to) return false;
  if (!e.rrule) return new Date(e.ends_at) > from;
  return !e.until || new Date(e.until) >= new Date(from.getTime() - 2 * 86400000);
}

export async function eventsInRange(from, to) {
  try {
    const rows = check(await sb.rpc('events_in_range', { p_from: from.toISOString(), p_to: to.toISOString() })
      .select(EVENT_SELECT));
    const all = (await cacheGet('events')) || {};
    for (const id of Object.keys(all)) if (inRange(all[id], from, to)) delete all[id]; // gelöschte entfernen
    for (const r of rows) all[r.id] = r;
    cacheSet('events', all);
    return rows;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    const all = await cacheGet('events');
    if (!all) throw e;
    return Object.values(all).filter((r) => inRange(r, from, to));
  }
}

export async function loadEvent(id) {
  try {
    return check(await sb.from('events').select(EVENT_SELECT).eq('id', id).maybeSingle());
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return ((await cacheGet('events')) || {})[id] || null;
  }
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
  return cached('notifications-' + limit, async () => check(await sb.from('notifications')
    .select('id, type, title, body, url, created_at, read_at, event_id, task_id')
    .order('created_at', { ascending: false })
    .limit(limit)));
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

// ---------- Aufgaben (ab Version 1.3) ----------
const TASK_SELECT = '*, task_assignees(user_id), task_reminders(offsets), comments(count)';

export async function listTasks() {
  return cached('tasks', async () => check(await sb.from('tasks').select(TASK_SELECT).order('created_at', { ascending: false }).limit(500)));
}

export async function loadTask(id) {
  try {
    return check(await sb.from('tasks').select(TASK_SELECT).eq('id', id).maybeSingle());
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return ((await cacheGet('tasks')) || []).find((t) => t.id === id) || null;
  }
}

export async function saveTask({ id, version, data, assignees, reminders }) {
  return check(await sb.rpc('save_task', {
    p_id: id || null, p_version: version ?? null, p_data: data, p_assignees: assignees, p_reminders: reminders,
  }));
}

async function patchCachedList(key, fn) {
  const list = await cacheGet(key);
  if (Array.isArray(list)) await cacheSet(key, fn(list));
}

registerHandler('task_status', async (op) => check(await sb.from('tasks').update({ status: op.status }).eq('id', op.id)));

export async function setTaskStatus(id, status) {
  try {
    return check(await sb.from('tasks').update({ status }).eq('id', id));
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue({ type: 'task_status', id, status });
    await patchCachedList('tasks', (l) => l.map((t) => (t.id === id ? { ...t, status, done_at: status === 'done' ? new Date().toISOString() : null } : t)));
  }
}

export async function taskHistory(id) {
  return check(await sb.from('task_history').select('*').eq('task_id', id).order('at', { ascending: false }));
}

// Erst die Dateien entfernen, dann den Eintrag (sonst blieben Dateien im Speicher liegen)
async function removeFilesOf(column, id) {
  const rows = check(await sb.from('attachments').select('storage_path').eq(column, id));
  const paths = (rows || []).map((r) => r.storage_path);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
}

export async function deleteTask(id) {
  await removeFilesOf('task_id', id).catch(() => {});
  return check(await sb.from('tasks').delete().eq('id', id));
}

export async function deleteEventWithFiles(id) {
  await removeFilesOf('event_id', id).catch(() => {});
  return check(await sb.from('events').delete().eq('id', id));
}

// ---------- Kommentare und Anhänge ----------
const targetCol = (t) => (t.eventId ? ['event_id', t.eventId] : ['task_id', t.taskId]);

export async function listComments(target) {
  const [col, id] = targetCol(target);
  return cached(`comments-${id}`, async () => check(await sb.from('comments').select('*').eq(col, id).order('created_at', { ascending: true })));
}

export async function addComment(target, familyId, authorId, body) {
  const [col, id] = targetCol(target);
  return check(await sb.from('comments').insert({ family_id: familyId, author_id: authorId, body, [col]: id }));
}

export async function deleteComment(id) {
  return check(await sb.from('comments').delete().eq('id', id));
}

export async function listAttachments(target) {
  const [col, id] = targetCol(target);
  return cached(`attachments-${id}`, async () => check(await sb.from('attachments').select('*').eq(col, id).order('created_at', { ascending: true })));
}

export async function uploadAttachment(target, familyId, userId, blob, fileName) {
  const [col, id] = targetCol(target);
  const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }[blob.type];
  const path = `${familyId}/${col === 'event_id' ? 'events' : 'tasks'}/${id}/${crypto.randomUUID()}.${ext}`;
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '3600' }));
  try {
    check(await sb.from('attachments').insert({
      family_id: familyId, [col]: id, storage_path: path, file_name: fileName.slice(0, 200),
      mime: blob.type, size_bytes: blob.size, uploaded_by: userId,
    }));
  } catch (e) {
    await sb.storage.from(BUCKET).remove([path]);
    throw e;
  }
}

export async function deleteAttachment(att) {
  check(await sb.from('attachments').delete().eq('id', att.id));
  await sb.storage.from(BUCKET).remove([att.storage_path]);
}

// ---------- Essenswünsche (ab Version 1.4) ----------
const MEAL_SELECT = '*, meal_likes(user_id), meal_favorites(user_id)';

export async function listMeals() {
  return cached('meals', async () => check(await sb.from('meal_wishes').select(MEAL_SELECT).order('created_at', { ascending: false }).limit(500)));
}

export async function loadMeal(id) {
  try {
    return check(await sb.from('meal_wishes').select(MEAL_SELECT).eq('id', id).maybeSingle());
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return ((await cacheGet('meals')) || []).find((m) => m.id === id) || null;
  }
}

export async function createMeal(row) {
  return check(await sb.from('meal_wishes').insert(row).select('id').single()).id;
}

export async function updateMeal(id, patch) {
  return check(await sb.from('meal_wishes').update(patch).eq('id', id));
}

export async function deleteMeal(meal) {
  if (meal.image_path) await sb.storage.from(BUCKET).remove([meal.image_path]).catch(() => {});
  return check(await sb.from('meal_wishes').delete().eq('id', meal.id));
}

export async function setMealCooked(id, cooked) {
  return check(await sb.rpc('set_meal_cooked', { p_meal: id, p_cooked: cooked }));
}

export async function setMealMark(table, mealId, userId, on) {
  if (on) return check(await sb.from(table).insert({ meal_id: mealId, user_id: userId }));
  return check(await sb.from(table).delete().eq('meal_id', mealId).eq('user_id', userId));
}

export async function uploadMealImage(familyId, mealId, blob) {
  const path = `${familyId}/meals/${mealId}/${crypto.randomUUID()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '3600' }));
  return path;
}

export async function removeFile(path) {
  if (path) await sb.storage.from(BUCKET).remove([path]).catch(() => {});
}

// ---------- Einkaufsliste (ab Version 1.5) ----------
export async function listShopping() {
  return cached('shopping', async () => check(await sb.from('shopping_items').select('*').order('created_at', { ascending: true }).limit(1000)));
}

// Änderungen an der Einkaufsliste funktionieren auch ohne Netz
registerHandler('shopping_add', async (op) => {
  const { error } = await sb.from('shopping_items').insert(op.rows);
  if (error && error.code !== '23505') throw error; // 23505 = schon übertragen
});
registerHandler('shopping_update', async (op) => check(await sb.from('shopping_items').update(op.patch).eq('id', op.id)));
registerHandler('shopping_delete', async (op) => check(await sb.from('shopping_items').delete().eq('id', op.id)));
registerHandler('shopping_delete_done', async (op) => check(await sb.from('shopping_items').delete().in('id', op.ids)));

async function offlineOr(run, op, patchCache) {
  try {
    return await run();
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue(op);
    await patchCachedList('shopping', patchCache);
  }
}

export async function addShopping(items) {
  for (const i of items) i.id = i.id || crypto.randomUUID();
  const now = new Date().toISOString();
  return offlineOr(async () => check(await sb.from('shopping_items').insert(items)),
    { type: 'shopping_add', rows: items },
    (l) => [...l, ...items.map((i) => ({ ...i, done: false, created_at: now }))]);
}

export async function updateShopping(id, patch) {
  return offlineOr(async () => check(await sb.from('shopping_items').update(patch).eq('id', id)),
    { type: 'shopping_update', id, patch },
    (l) => l.map((i) => (i.id === id ? { ...i, ...patch, done_at: patch.done ? new Date().toISOString() : i.done_at } : i)));
}

export async function deleteShopping(id) {
  return offlineOr(async () => check(await sb.from('shopping_items').delete().eq('id', id)),
    { type: 'shopping_delete', id }, (l) => l.filter((i) => i.id !== id));
}

export async function deleteDoneShopping() {
  const ids = ((await cacheGet('shopping')) || []).filter((i) => i.done).map((i) => i.id);
  return offlineOr(async () => check(await sb.from('shopping_items').delete().eq('done', true)),
    { type: 'shopping_delete_done', ids }, (l) => l.filter((i) => !i.done));
}

// ---------- Geräte (ab Version 1.6) ----------
export async function mySessions() {
  return check(await sb.rpc('my_sessions'));
}

export async function revokeSession(id) {
  return check(await sb.rpc('revoke_session', { p_id: id }));
}

export async function signOutOthers() {
  const { error } = await sb.auth.signOut({ scope: 'others' });
  if (error) throw error;
}

// Live-Änderungen anderer Geräte
export function watchShopping(onChange) {
  const channel = sb.channel('einkauf-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items' }, () => onChange())
    .subscribe();
  return () => { sb.removeChannel(channel); };
}
