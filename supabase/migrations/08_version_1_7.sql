-- =====================================================================
-- Familienzeit – Datenbank Version 1.7: Kalenderimport und externe Kalender
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Externe Kalender (Abos über einen privaten ICS-Link, nur lesend)
-- ---------------------------------------------------------------------
create table public.calendar_feeds (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families(id) on delete restrict,
  user_id          uuid not null references auth.users(id) on delete restrict,
  label            text not null check (char_length(trim(label)) between 1 and 60),
  provider         text not null default 'other' check (provider in ('google', 'outlook', 'other')),
  visibility       text not null default 'private' check (visibility in ('family', 'parents', 'private')),
  assign_me        boolean not null default true,
  paused           boolean not null default false,
  sync_requested   boolean not null default true,
  last_sync_at     timestamptz,
  last_error       text,
  fail_count       int not null default 0,
  event_count      int not null default 0,
  created_at       timestamptz not null default now()
);
create index calendar_feeds_user on public.calendar_feeds (user_id);

-- Der Link selbst ist geheim: für die App unsichtbar, nur die Server-Funktion liest ihn
create table public.calendar_feed_urls (
  feed_id uuid primary key references public.calendar_feeds(id) on delete cascade,
  url     text not null check (url ~* '^https://' and char_length(url) <= 2000)
);
alter table public.calendar_feeds enable row level security;
alter table public.calendar_feed_urls enable row level security;
revoke all on public.calendar_feeds, public.calendar_feed_urls from anon, authenticated;
grant select on public.calendar_feeds to authenticated;
create policy feeds_own_select on public.calendar_feeds for select to authenticated
  using (user_id = (select auth.uid()));

-- Termine kennen ihre Herkunft
alter table public.events add column feed_id uuid references public.calendar_feeds(id) on delete cascade;
create index events_feed on public.events (feed_id) where feed_id is not null;
create index events_external_uid on public.events (family_id, external_uid) where external_uid is not null;

-- ---------------------------------------------------------------------
-- Massenänderungen (Import, Abgleich) erzeugen keine Einzel-Meldungen
-- ---------------------------------------------------------------------
create function public.fz_bulk() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('fz.bulk', true), '') = 'on'
$$;

create or replace function public.events_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
  else
    if new.visibility is distinct from old.visibility and auth.uid() is not null
       and auth.uid() is distinct from old.owner_id then
      raise exception 'Nur der Ersteller kann die Sichtbarkeit ändern';
    end if;
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.rrule is null then new.until := null; end if;
  return new;
end;
$$;

create or replace function public.events_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  what text[] := '{}';
begin
  if public.fz_bulk() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.notify_audience(new.id, 'event_new', 'Neuer Termin: ' || new.title,
      public.fz_when(new.starts_at, new.all_day, new.rrule is not null) || ' · von ' || public.actor_name(),
      public.fz_day_url(new.starts_at), true);
    return null;
  end if;

  if new.title is distinct from old.title then what := array_append(what, 'Titel'); end if;
  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
     or new.all_day is distinct from old.all_day then what := array_append(what, 'Zeit'); end if;
  if new.location is distinct from old.location then what := array_append(what, 'Ort'); end if;
  if new.rrule is distinct from old.rrule or new.until is distinct from old.until then what := array_append(what, 'Wiederholung'); end if;
  if cardinality(what) = 0 then return null; end if;

  perform public.notify_audience(new.id, 'event_changed', 'Termin geändert: ' || new.title,
    array_to_string(what, ', ') || ' geändert · ' || public.fz_when(new.starts_at, new.all_day, new.rrule is not null)
      || ' · von ' || public.actor_name(),
    public.fz_day_url(new.starts_at), true);
  return null;
end;
$$;

create or replace function public.exceptions_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.events%rowtype;
  v_start timestamptz := coalesce(new.starts_at, new.original_start);
begin
  if public.fz_bulk() then return null; end if;
  select * into e from public.events where id = new.event_id;
  if not found then return null; end if;
  if new.cancelled then
    perform public.notify_audience(e.id, 'event_cancelled', 'Termin abgesagt: ' || coalesce(new.title, e.title),
      public.fz_when(new.original_start, e.all_day, false) || ' · von ' || public.actor_name(),
      public.fz_day_url(new.original_start), true);
  else
    perform public.notify_audience(e.id, 'event_changed', 'Termin geändert: ' || coalesce(new.title, e.title),
      'Nur dieser Termin · ' || public.fz_when(v_start, coalesce(new.all_day, e.all_day), false) || ' · von ' || public.actor_name(),
      public.fz_day_url(v_start), true);
  end if;
  return null;
end;
$$;

create or replace function public.events_notify_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.fz_bulk() then return old; end if;
  perform public.notify_audience(old.id,
    'event_deleted', (case when old.rrule is not null then 'Serie gelöscht: ' else 'Termin gelöscht: ' end) || old.title,
    public.fz_when(old.starts_at, old.all_day, old.rrule is not null) || ' · von ' || public.actor_name(),
    '#/kalender', false);
  return old;
end;
$$;

-- Verlauf beim Abgleich nicht mit jeder Ausnahme füllen
create or replace function public.exceptions_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.fz_bulk() then return null; end if;
  if not exists (select 1 from public.events where id = new.event_id) then return null; end if;
  insert into public.event_history (event_id, actor_id, action, changes)
  values (new.event_id, auth.uid(),
          case when new.cancelled then 'instance_cancelled' else 'instance_changed' end,
          jsonb_build_object('original_start', new.original_start));
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Termine aus externen Kalendern sind nur lesbar (sie kämen beim nächsten Abgleich zurück)
-- ---------------------------------------------------------------------
create or replace function public.can_edit_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_see_event(p_event) and exists (
    select 1 from public.events e
    where e.id = p_event
      and e.feed_id is null
      and (   e.owner_id = auth.uid()
           or exists (select 1 from public.event_participants p where p.event_id = e.id and p.user_id = auth.uid())
           or not exists (select 1 from public.event_participants p where p.event_id = e.id))
  )
$$;

-- Kommentare und Anhänge an externen Terminen bleiben möglich (Sichtbarkeit genügt);
-- Löschen eigener Anhänge ebenfalls (uploaded_by).

-- ---------------------------------------------------------------------
-- Import aus einer .ics-Datei
-- ---------------------------------------------------------------------
create function public.import_events(p_items jsonb, p_participants uuid[], p_visibility text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_family uuid := public.my_family();
  v_role text := public.my_role();
  v_item jsonb;
  v_x jsonb;
  v_id uuid;
  v_first uuid;
  v_count int := 0;
  v_parts uuid[] := coalesce(p_participants, '{}'::uuid[]);
begin
  if v_family is null then raise exception 'Nicht angemeldet'; end if;
  if p_visibility not in ('family', 'parents', 'private') then raise exception 'Ungültige Sichtbarkeit'; end if;
  if p_visibility = 'parents' and v_role not in ('admin', 'parent') then raise exception 'Keine Berechtigung'; end if;
  if jsonb_array_length(p_items) > 2000 then raise exception 'Zu viele Termine auf einmal (höchstens 2000)'; end if;
  if p_visibility = 'private' then v_parts := '{}'; end if;

  perform set_config('fz.bulk', 'on', true);

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.events (family_id, owner_id, title, description, location, starts_at, ends_at, all_day,
                               visibility, rrule, until, source, external_uid)
    values (v_family, auth.uid(),
            left(coalesce(nullif(trim(v_item ->> 'title'), ''), '(ohne Titel)'), 120),
            left(nullif(trim(v_item ->> 'description'), ''), 4000),
            left(nullif(trim(v_item ->> 'location'), ''), 200),
            (v_item ->> 'starts_at')::timestamptz,
            greatest((v_item ->> 'ends_at')::timestamptz, (v_item ->> 'starts_at')::timestamptz),
            coalesce((v_item ->> 'all_day')::boolean, false),
            p_visibility,
            nullif(v_item ->> 'rrule', ''),
            nullif(v_item ->> 'until', '')::date,
            'ics',
            left(nullif(v_item ->> 'external_uid', ''), 500))
    returning id into v_id;
    v_first := coalesce(v_first, v_id);

    insert into public.event_participants (event_id, user_id)
    select v_id, u from unnest(v_parts) as u on conflict do nothing;

    for v_x in select * from jsonb_array_elements(coalesce(v_item -> 'exceptions', '[]'::jsonb)) loop
      insert into public.event_exceptions (event_id, original_start, cancelled, title, description, location, starts_at, ends_at, all_day)
      values (v_id, (v_x ->> 'original_start')::timestamptz, coalesce((v_x ->> 'cancelled')::boolean, false),
              left(nullif(v_x ->> 'title', ''), 120), left(nullif(v_x ->> 'description', ''), 4000), left(nullif(v_x ->> 'location', ''), 200),
              (v_x ->> 'starts_at')::timestamptz, (v_x ->> 'ends_at')::timestamptz, (v_x ->> 'all_day')::boolean)
      on conflict do nothing;
    end loop;
    v_count := v_count + 1;
  end loop;

  -- Eine einzige Sammelmeldung statt vieler einzelner
  if v_first is not null then
    insert into public.notifications (user_id, type, title, body, url, push_state)
    select a, 'event_new',
           case when v_count = 1 then '1 Termin importiert' else v_count || ' Termine importiert' end,
           'von ' || public.actor_name(), '#/kalender',
           case when public.push_wanted(a, 'event_new') then 'pending' else 'skipped' end
    from public.event_audience(v_first) as a
    where a is distinct from auth.uid();
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Externe Kalender verwalten (jeder nur seine eigenen)
-- ---------------------------------------------------------------------
create function public.fz_feed_url(p_url text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  u text := trim(p_url);
begin
  if u ~* '^webcals?://' then u := regexp_replace(u, '^webcals?://', 'https://', 'i'); end if;
  if u ~* '^http://' then u := regexp_replace(u, '^http://', 'https://', 'i'); end if;
  if u !~* '^https://[^\s/]+\.[^\s/]+/\S*$' or char_length(u) > 2000 then
    raise exception 'Ungültiger Kalender-Link';
  end if;
  return u;
end;
$$;

create function public.add_feed(p_label text, p_provider text, p_url text, p_visibility text, p_assign_me boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if public.my_family() is null then raise exception 'Nicht angemeldet'; end if;
  if p_visibility = 'parents' and public.my_role() not in ('admin', 'parent') then raise exception 'Keine Berechtigung'; end if;
  if (select count(*) from public.calendar_feeds where user_id = auth.uid()) >= 5 then
    raise exception 'Höchstens 5 externe Kalender pro Person';
  end if;
  insert into public.calendar_feeds (family_id, user_id, label, provider, visibility, assign_me)
  values (public.my_family(), auth.uid(), left(trim(p_label), 60), coalesce(p_provider, 'other'), p_visibility, coalesce(p_assign_me, true))
  returning id into v_id;
  insert into public.calendar_feed_urls (feed_id, url) values (v_id, public.fz_feed_url(p_url));
  perform public.kick_push();
  return v_id;
end;
$$;

create function public.update_feed(p_id uuid, p_label text, p_visibility text, p_assign_me boolean, p_paused boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.calendar_feeds%rowtype;
begin
  select * into f from public.calendar_feeds where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Keine Berechtigung'; end if;
  if p_visibility = 'parents' and public.my_role() not in ('admin', 'parent') then raise exception 'Keine Berechtigung'; end if;

  update public.calendar_feeds
     set label = left(trim(p_label), 60), visibility = p_visibility, assign_me = p_assign_me, paused = p_paused,
         sync_requested = case when p_paused then false when f.paused then true else sync_requested end
   where id = p_id;

  perform set_config('fz.bulk', 'on', true);
  if p_visibility is distinct from f.visibility then
    update public.events set visibility = p_visibility where feed_id = p_id;
  end if;
  if p_visibility = 'private' or not p_assign_me then
    delete from public.event_participants p using public.events e
     where e.id = p.event_id and e.feed_id = p_id and p.user_id = auth.uid();
  elsif p_assign_me then
    insert into public.event_participants (event_id, user_id)
    select e.id, auth.uid() from public.events e where e.feed_id = p_id on conflict do nothing;
  end if;
  if not p_paused and f.paused then perform public.kick_push(); end if;
end;
$$;

create function public.request_feed_sync(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.calendar_feeds set sync_requested = true, paused = false
   where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Keine Berechtigung'; end if;
  perform public.kick_push();
end;
$$;

-- Verbindung beenden: Abo und alle daraus übernommenen Termine entfernen
create function public.delete_feed(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.calendar_feeds where id = p_id and user_id = auth.uid()) then
    raise exception 'Keine Berechtigung';
  end if;
  perform set_config('fz.bulk', 'on', true);
  delete from public.calendar_feeds where id = p_id;
end;
$$;

-- Funktionsrechte neu setzen
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_family(), public.my_role(), public.is_admin(),
  public.create_invitation(text), public.revoke_invitation(uuid),
  public.can_see_event(uuid), public.can_edit_event(uuid),
  public.events_in_range(timestamptz, timestamptz),
  public.save_event(uuid, int, jsonb, uuid[], int[]),
  public.push_public_key(), public.register_push(text, text, text, text),
  public.unregister_push(text), public.send_test_push(),
  public.can_see_task(uuid), public.can_edit_task(uuid),
  public.can_see_target(uuid, uuid), public.can_edit_target(uuid, uuid),
  public.storage_target(text), public.storage_can_upload(text), public.storage_can_read(text), public.storage_can_delete(text),
  public.save_task(uuid, int, jsonb, uuid[], int[]),
  public.meal_in_my_family(uuid), public.set_meal_cooked(uuid, boolean), public.meal_storage_ok(text, boolean),
  public.my_sessions(), public.revoke_session(uuid),
  public.import_events(jsonb, uuid[], text),
  public.add_feed(text, text, text, text, boolean), public.update_feed(uuid, text, text, boolean, boolean),
  public.request_feed_sync(uuid), public.delete_feed(uuid)
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open()
  to anon, authenticated;
