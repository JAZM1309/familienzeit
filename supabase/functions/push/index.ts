// Familienzeit – Push-Funktion (Supabase Edge Function)
// Wird jede Minute von der Datenbank (pg_cron) und sofort bei neuen Meldungen aufgerufen.
// 1. berechnet fällige Erinnerungen, 2. verschickt offene Benachrichtigungen.
import postgres from 'npm:postgres@3.4.5';
import { generateVapidKeys, sendPush } from './webpush.js';
import { dueReminders, toWall, fromWall } from './reminders.js';
import { icsToEvents } from './ics.js';
import { planSync, feedErrorText } from './feeds.js';

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

// Aufgaben: Erinnerung relativ zur Fälligkeit (ganztägig fällig = 9:00 Uhr am Fälligkeitstag)
async function createTaskReminders(now: Date): Promise<number> {
  const rows = await sql`
    select r.user_id, r.offsets, t.id, t.title, t.due_at, t.due_all_day
    from public.task_reminders r join public.tasks t on t.id = r.task_id
    where t.status <> 'done' and t.due_at is not null
      and t.due_at between now() - interval '1 day' and now() + interval '30 days'`;
  const pseudo = rows.map((r) => ({
    id: r.id, user_id: r.user_id, offsets: r.offsets, title: r.title, location: null, rrule: null,
    all_day: false,
    starts_at: r.due_all_day ? fromWall(new Date(toWall(new Date(r.due_at)).getTime() + 9 * 3600000)) : r.due_at,
    due_at: r.due_at,
  }));
  let created = 0;
  for (const d of dueReminders(pseudo, now)) {
    const src = pseudo.find((p) => p.id === d.event_id)!;
    const title = d.offset === 0 ? `Jetzt fällig: ${src.title}` : `Bald fällig: ${src.title}`;
    const [r] = await sql`select public.add_task_reminder(${d.event_id}, ${d.user_id}, ${src.due_at}, ${d.offset}, ${title}, ${d.body}) as ok`;
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
    const reminder = n.type === 'reminder' || n.type === 'task_reminder';
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

// ---------- Externe Kalender: pro Aufruf höchstens ein Abo abgleichen ----------
const MAX_ICS = 5 * 1024 * 1024;

async function fetchIcs(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Familienzeit-Kalender/1.0', Accept: 'text/calendar, */*' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(feedErrorText(res.status));
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_ICS) throw new Error('Der Kalender ist zu groß (über 5 MB).');
    const text = await res.text();
    if (text.length > MAX_ICS) throw new Error('Der Kalender ist zu groß (über 5 MB).');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Unter dem Link liegt kein Kalender. Bitte den Link prüfen (er endet meist auf .ics).');
    return text;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Der Kalender-Anbieter antwortet nicht. Es wird später erneut versucht.');
    if ((e as Error).message?.startsWith('Der ') || (e as Error).message?.startsWith('Unter ')) throw e;
    throw new Error('Der Kalender konnte nicht abgerufen werden. Es wird später erneut versucht.');
  } finally {
    clearTimeout(timer);
  }
}

async function syncOneFeed(): Promise<string | null> {
  const [f] = await sql`
    select f.id, f.family_id, f.user_id, f.visibility, f.assign_me, f.color, u.url
    from public.calendar_feeds f join public.calendar_feed_urls u on u.feed_id = f.id
    where not f.paused
      and (f.sync_requested or f.last_sync_at is null
           or f.last_sync_at < now() - case when f.fail_count >= 5 then interval '3 hours' else interval '30 minutes' end)
    order by f.sync_requested desc, f.last_sync_at nulls first
    limit 1`;
  if (!f) return null;
  await sql`update public.calendar_feeds set sync_requested = false, last_sync_at = now() where id = ${f.id}`;

  let items;
  try {
    const text = await fetchIcs(f.url);
    const now = Date.now();
    items = icsToEvents(text, { from: new Date(now - 60 * 86400000), to: new Date(now + 2 * 365 * 86400000) }).events.slice(0, 3000);
  } catch (e) {
    const msg = String((e as Error).message || 'Unbekannter Fehler').slice(0, 300);
    await sql`update public.calendar_feeds set last_error = ${msg}, fail_count = fail_count + 1 where id = ${f.id}`;
    return 'error';
  }

  const assign = f.assign_me && f.visibility !== 'private';
  let total = 0;
  await sql.begin(async (tx) => {
    await tx`select set_config('fz.bulk', 'on', true)`;
    const existing = await tx`
      select e.id, e.external_uid, e.title, e.description, e.location, e.starts_at, e.ends_at, e.all_day, e.rrule,
             e.until::text as until, e.visibility, e.color,
             coalesce((select json_agg(x) from public.event_exceptions x where x.event_id = e.id), '[]'::json) as exceptions
      from public.events e where e.feed_id = ${f.id}`;
    const plan = planSync(existing, items, f.visibility, f.color);
    total = plan.total;

    const writeExceptions = async (id: string, list: any[]) => {
      await tx`delete from public.event_exceptions where event_id = ${id}`;
      for (const x of list) {
        await tx`insert into public.event_exceptions (event_id, original_start, cancelled, title, description, location, starts_at, ends_at, all_day)
          values (${id}, ${x.original_start}, ${!!x.cancelled}, ${x.title ?? null}, ${x.description ?? null}, ${x.location ?? null},
                  ${x.starts_at ?? null}, ${x.ends_at ?? null}, ${x.all_day ?? null})
          on conflict do nothing`;
      }
    };

    for (const n of plan.inserts) {
      const [row] = await tx`
        insert into public.events (family_id, owner_id, title, description, location, starts_at, ends_at, all_day,
                                   visibility, rrule, until, source, feed_id, external_uid, color)
        values (${f.family_id}, ${f.user_id}, ${n.title}, ${n.description}, ${n.location}, ${n.starts_at}, ${n.ends_at}, ${n.all_day},
                ${f.visibility}, ${n.rrule}, ${n.until}, 'feed', ${f.id}, ${n.external_uid}, ${f.color})
        returning id`;
      if (assign) await tx`insert into public.event_participants (event_id, user_id) values (${row.id}, ${f.user_id}) on conflict do nothing`;
      if (n.exceptions.length) await writeExceptions(row.id, n.exceptions);
    }
    for (const u of plan.updates) {
      const n = u.item;
      if (u.main) {
        await tx`update public.events set title = ${n.title}, description = ${n.description}, location = ${n.location},
          starts_at = ${n.starts_at}, ends_at = ${n.ends_at}, all_day = ${n.all_day}, rrule = ${n.rrule}, until = ${n.until},
          visibility = ${f.visibility}, color = ${f.color}
          where id = ${u.id}`;
      }
      if (u.exc) await writeExceptions(u.id, n.exceptions);
    }
    if (plan.deletes.length) await tx`delete from public.events where id = any(${plan.deletes}::uuid[])`;
  });
  await sql`update public.calendar_feeds set last_error = null, fail_count = 0, event_count = ${total}, last_sync_at = now() where id = ${f.id}`;
  return 'ok';
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
    const reminders = await createReminders(now) + await createTaskReminders(now);
    const result = await sendPending(vapid);
    let feed = null;
    try { feed = await syncOneFeed(); } catch (e) { console.error('feed', e); }
    await housekeeping();
    return Response.json({ reminders, ...result, feed });
  } catch (e) {
    console.error(e);
    return new Response('error', { status: 500 });
  }
});
