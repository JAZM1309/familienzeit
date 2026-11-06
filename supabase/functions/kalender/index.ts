// Familienzeit – Kalender für Widgets und Kalender-Abos (Supabase Edge Function)
// Aufruf mit dem persönlichen Link aus der App:
//   …/functions/v1/kalender?t=<code>            → Widget-Daten (JSON)
//   …/functions/v1/kalender?t=<code>&f=ics      → abonnierbarer Kalender (.ics)
// Es erscheinen genau die Termine, die diese Person auch in der App sieht.
import postgres from 'npm:postgres@3.4.5';
import { buildICS } from './ics-export.js';
import { widgetJson } from './widget.js';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 20 });
const DAY = 86400000;

const headers = (type: string, maxAge: number) => ({
  'Content-Type': type,
  'Cache-Control': `private, max-age=${maxAge}`,
  'Access-Control-Allow-Origin': '*',
  'X-Robots-Tag': 'noindex',
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } });
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Nur GET', { status: 405 });
  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get('t') || '').trim().toLowerCase();
    const format = /ics|webcal|kalender/i.test(url.searchParams.get('f') || '') ? 'ics' : 'json';
    const now = new Date();

    // ICS: weiter Zeitraum, damit Serien vollständig ankommen. JSON: ab Monatsanfang für die Monatsansicht.
    const days = Math.min(400, Math.max(1, Number(url.searchParams.get('tage') || 45)));
    const from = format === 'ics' ? new Date(now.getTime() - 90 * DAY) : new Date(now.getTime() - 40 * DAY);
    const to = format === 'ics' ? new Date(now.getTime() + 3 * 365 * DAY) : new Date(now.getTime() + days * DAY);

    const [row] = await sql`select public.widget_data(${token}, ${from}, ${to}) as data`;
    const data = row?.data;
    if (!data) {
      return new Response('Dieser Link ist ungültig oder wurde in der App erneuert.', { status: 404, headers: headers('text/plain; charset=utf-8', 60) });
    }

    if (format === 'ics') {
      const names = new Map(data.members.map((m: any) => [m.id, m.name]));
      const events = data.events.map((e: any) => ({
        ...e,
        event_participants: e.participants.map((id: string) => ({ user_id: id })),
        event_exceptions: e.exceptions,
        event_reminders: [],
      }));
      const text = buildICS(events, { name: data.family || 'Familienzeit', nameOf: (id: string) => names.get(id) || '', now });
      return new Response(text, {
        headers: { ...headers('text/calendar; charset=utf-8', 600), 'Content-Disposition': 'inline; filename="familienzeit.ics"' },
      });
    }

    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('anzahl') || 10)));
    return Response.json(widgetJson(data, now, { days, limit }), { headers: headers('application/json; charset=utf-8', 300) });
  } catch (e) {
    console.error(e);
    return new Response('Fehler', { status: 500 });
  }
});
