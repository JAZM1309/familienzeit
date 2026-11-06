-- =====================================================================
-- Familienzeit – Datenbank Version 2.3.0: Widgets und Kalender-Abo
-- Jede Person kann einen persönlichen Link erzeugen. Darüber liefert die
-- Server-Funktion "kalender" ihre Termine als Widget-Daten (JSON) oder als
-- abonnierbaren Kalender (.ics) – mit denselben Sichtbarkeitsregeln wie in der App.
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

-- Gespeichert wird nur der Hash des Links, nie der Link selbst
create table public.widget_tokens (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  family_id    uuid not null references public.families(id) on delete restrict,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.widget_tokens enable row level security;
revoke all on public.widget_tokens from anon, authenticated;
grant select (user_id, created_at, last_used_at) on public.widget_tokens to authenticated;
create policy widget_tokens_own_select on public.widget_tokens for select to authenticated
  using (user_id = (select auth.uid()));

-- Neuen Link erzeugen (ein alter Link wird dabei ungültig)
create function public.renew_widget_token() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_fam   uuid := public.my_family();
  v_token text;
begin
  if v_fam is null then raise exception 'Nicht angemeldet'; end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.widget_tokens (user_id, family_id, token_hash)
  values (auth.uid(), v_fam, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  on conflict (user_id) do update
    set token_hash = excluded.token_hash, family_id = excluded.family_id, created_at = now(), last_used_at = null;
  return v_token;
end;
$$;

-- Link abschalten
create function public.delete_widget_token() returns void
language sql security definer set search_path = '' as $$
  delete from public.widget_tokens where user_id = auth.uid()
$$;

-- Nur für die Server-Funktion: alle Termine, die diese Person sehen darf,
-- die den Zeitraum [p_from, p_to) berühren können (Serien werden in der Funktion aufgefaltet)
create function public.widget_data(p_token text, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w public.widget_tokens%rowtype;
  m public.members%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return null; end if;
  select * into w from public.widget_tokens
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then return null; end if;
  select * into m from public.members where user_id = w.user_id and family_id = w.family_id;
  if not found then return null; end if;

  update public.widget_tokens set last_used_at = now()
    where user_id = w.user_id and (last_used_at is null or last_used_at < now() - interval '10 minutes');

  return jsonb_build_object(
    'family', (select name from public.families where id = m.family_id),
    'me', jsonb_build_object('id', m.user_id, 'name', m.display_name, 'color', m.color),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', x.user_id, 'name', x.display_name, 'color', x.color)
                                          order by x.joined_at), '[]'::jsonb)
                from public.members x where x.family_id = m.family_id),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'owner_id', e.owner_id, 'title', e.title, 'description', e.description, 'location', e.location,
               'starts_at', e.starts_at, 'ends_at', e.ends_at, 'all_day', e.all_day, 'visibility', e.visibility,
               'rrule', e.rrule, 'until', e.until, 'color', e.color, 'created_at', e.created_at, 'updated_at', e.updated_at,
               'participants', coalesce((select jsonb_agg(p.user_id) from public.event_participants p where p.event_id = e.id), '[]'::jsonb),
               'exceptions', coalesce((select jsonb_agg(jsonb_build_object(
                    'original_start', x.original_start, 'cancelled', x.cancelled, 'title', x.title,
                    'description', x.description, 'location', x.location,
                    'starts_at', x.starts_at, 'ends_at', x.ends_at, 'all_day', x.all_day))
                  from public.event_exceptions x where x.event_id = e.id), '[]'::jsonb)
             ) order by e.starts_at), '[]'::jsonb)
      from public.events e
      where e.family_id = m.family_id
        and (   e.visibility = 'family'
             or (e.visibility = 'parents' and m.role in ('admin', 'parent'))
             or (e.visibility = 'private' and e.owner_id = m.user_id))
        and e.starts_at < p_to
        and (   (e.rrule is null and e.ends_at >= p_from - interval '1 day')
             or (e.rrule is not null and (e.until is null or e.until >= (p_from - interval '1 day')::date)))
    ));
end;
$$;

revoke execute on function public.renew_widget_token(), public.delete_widget_token() from public, anon;
grant execute on function public.renew_widget_token(), public.delete_widget_token() to authenticated;
-- widget_data ist ausschließlich für die Server-Funktion gedacht
revoke execute on function public.widget_data(text, timestamptz, timestamptz) from public, anon, authenticated;
