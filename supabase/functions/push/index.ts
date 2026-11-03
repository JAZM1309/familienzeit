// Familienzeit – Push-Funktion (Supabase Edge Function)
// Wird jede Minute von der Datenbank (pg_cron) und sofort bei neuen Meldungen aufgerufen.
// 1. berechnet fällige Erinnerungen, 2. verschickt offene Benachrichtigungen.
import postgres from 'npm:postgres@3.4.5';
import { generateVapidKeys, sendPush } from './webpush.js';
import { dueReminders } from './reminders.js';

const SUBJECT = 'https://jazm1309.github.io/Familienzeit/';
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 20 });

type Vapid = { publicKey: string; privateJwk: JsonWebKey; subject: string };

async function ensureKeys(cfg: { vapid_public: string | null; vapid_private: JsonWebKey | null }): Promise<Vapid> {
  if (cfg.vapid_public && cfg.vapid_private) {
    return { publicKey: cfg.vapid_public, privateJwk: cfg.vapid_private, subject: SUBJECT };
  }
  const k = await generateVapidKeys();
  const rows = await sql`
    update public.push_config set vapid_public = ${k.publicKey}, vapid_private = ${sql.json(k.privateJwk)}, updated_at = now()
    where id = 1 and vapid_public is null
    returning vapid_public, vapid_private`;
  const row = rows[0] ?? (await sql`select vapid_public, vapid_private from public.push_config where id = 1`)[0];
  return { publicKey: row.vapid_public, privateJwk: row.vapid_private, subject: SUBJECT };
}

async function createReminders(now: Date): Promise<number> {
  const rows = await sql`
    select r.user_id, r.offsets, e.id, e.title, e.location, e.starts_at, e.all_day, e.rrule, e.until::text as until,
           coalesce((select json_agg(x) from public.event_exceptions x where x.event_id = e.id), '[]'::json) as exceptions
    from public.event_reminders r
    join public.events e on e.id = r.event_id
    where e.starts_at < now() + interval '29 days'
      and (   (e.rrule is null and e.starts_at > now() - interval '1 hour')
           or (e.rrule is not null and (e.until is null or e.until >= current_date - 1)))`;
  let created = 0;
  for (const d of dueReminders(rows, now)) {
    const [r] = await sql`select public.add_reminder(${d.event_id}, ${d.user_id}, ${d.occurrence}, ${d.offset}, ${d.title}, ${d.body}, ${d.url}) as ok`;
    if (r.ok) created++;
  }
  return created;
}

async function sendPending(vapid: Vapid): Promise<{ sent: number; failed: number }> {
  const batch = await sql`
    update public.notifications n set push_state = 'sending', pushed_at = now()
    where n.id in (
      select id from public.notifications
      where push_state = 'pending' and created_at > now() - interval '1 day'
      order by id limit 50 for update skip locked)
    returning n.id, n.user_id, n.type, n.title, n.body, n.url`;
  let sent = 0, failed = 0;

  for (const n of batch) {
    const subs = await sql`select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = ${n.user_id}`;
    if (!subs.length) {
      await sql`update public.notifications set push_state = 'skipped' where id = ${n.id}`;
      continue;
    }
    const [{ unread }] = await sql`select count(*)::int as unread from public.notifications where user_id = ${n.user_id} and read_at is null`;
    const payload = { id: n.id, type: n.type, title: n.title, body: n.body, url: n.url || '#/meldungen', unread };
    const reminder = n.type === 'reminder';
    let ok = false;

    for (const s of subs) {
      try {
        const status = await sendPush(s, payload, vapid, { ttl: reminder ? 3600 : 86400, urgency: reminder ? 'high' : 'normal' });
        if (status >= 200 && status < 300) {
          ok = true;
          await sql`update public.push_subscriptions set last_success_at = now(), fail_count = 0 where id = ${s.id}`;
        } else if (status === 404 || status === 410) {
          await sql`delete from public.push_subscriptions where id = ${s.id}`; // Abo abgelaufen
        } else {
          console.warn('push status', status, new URL(s.endpoint).host);
          await sql`update public.push_subscriptions set fail_count = fail_count + 1 where id = ${s.id}`;
        }
      } catch (e) {
        console.warn('push error', String(e));
        await sql`update public.push_subscriptions set fail_count = fail_count + 1 where id = ${s.id}`;
      }
    }
    await sql`update public.notifications set push_state = ${ok ? 'sent' : 'failed'} where id = ${n.id}`;
    if (ok) sent++; else failed++;
  }
  return { sent, failed };
}

async function housekeeping() {
  // gelegentlich aufräumen
  if (Math.random() > 0.02) return;
  await sql`delete from public.notifications where created_at < now() - interval '90 days'`;
  await sql`delete from public.reminder_log where created_at < now() - interval '60 days'`;
  await sql`delete from public.push_subscriptions where fail_count >= 20`;
  await sql`update public.notifications set push_state = 'failed' where push_state = 'sending' and pushed_at < now() - interval '1 hour'`;
}

Deno.serve(async (req) => {
  try {
    const [cfg] = await sql`select secret, vapid_public, vapid_private from public.push_config where id = 1`;
    if (!cfg || req.headers.get('x-fz-secret') !== cfg.secret) {
      return new Response('forbidden', { status: 403 });
    }
    const vapid = await ensureKeys(cfg);
    const now = new Date();
    const reminders = await createReminders(now);
    const result = await sendPending(vapid);
    await housekeeping();
    return Response.json({ reminders, ...result });
  } catch (e) {
    console.error(e);
    return new Response('error', { status: 500 });
  }
});
