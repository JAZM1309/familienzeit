// Familienzeit – neues Passwort über einen Link vom Administrator setzen
// Aufruf aus der App: POST { token, password }
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 20 });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST' });

  let token = '';
  let password = '';
  try {
    const body = await req.json();
    token = String(body.token || '');
    password = String(body.password || '');
  } catch {
    return reply(400, { error: 'Ungültige Anfrage.' });
  }
  if (!/^[0-9a-f]{48}$/.test(token)) return reply(400, { error: 'Der Link ist ungültig.' });
  if (password.length < 8 || password.length > 72) return reply(400, { error: 'Das Passwort braucht 8 bis 72 Zeichen.' });

  try {
    const [r] = await sql`select reset_id, user_id from public.consume_password_reset(${token})`;
    if (!r?.user_id) return reply(410, { error: 'Der Link ist abgelaufen, wurde schon benutzt oder zurückgezogen. Bitte den Administrator um einen neuen.' });

    const { error } = await admin.auth.admin.updateUserById(r.user_id, { password });
    if (error) {
      await sql`select public.release_password_reset(${r.reset_id})`;
      const weak = /weak|short|characters/i.test(error.message);
      return reply(400, { error: weak ? 'Das Passwort ist zu schwach. Bitte ein längeres wählen.' : 'Das Passwort konnte nicht gespeichert werden.' });
    }
    return reply(200, { ok: true });
  } catch (e) {
    console.error(e);
    return reply(500, { error: 'Das hat nicht geklappt. Bitte später noch einmal versuchen.' });
  }
});
