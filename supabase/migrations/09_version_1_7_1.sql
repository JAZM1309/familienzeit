-- =====================================================================
-- Familienzeit – Datenbank Version 1.7.1: Farben für externe und importierte Kalender
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

-- Farbe je externem Kalender
alter table public.calendar_feeds
  add column color text not null default '#5B7FDB' check (color ~ '^#[0-9A-Fa-f]{6}$');

-- Importierte Kalender bekommen Namen und Farbe
create table public.calendar_imports (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete restrict,
  owner_id    uuid not null references auth.users(id) on delete restrict,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  color       text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  event_count int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.calendar_imports enable row level security;
revoke all on public.calendar_imports from anon, authenticated;
grant select on public.calendar_imports to authenticated;
create policy imports_own_select on public.calendar_imports for select to authenticated
  using (owner_id = (select auth.uid()));

-- Die Farbe steht direkt am Termin, damit alle, die den Termin sehen dürfen, sie auch sehen
alter table public.events
  add column color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  add column import_id uuid references public.calendar_imports(id) on delete cascade;
create index events_import on public.events (import_id) where import_id is not null;

-- Bestehende Abo-Termine bekommen die Standardfarbe ihres Abos
update public.events e set color = f.color from public.calendar_feeds f where e.feed_id = f.id;

-- ---------------------------------------------------------------------
-- Import: jetzt mit Name und Farbe
-- ---------------------------------------------------------------------
drop function public.import_events(jsonb, uuid[], text);

create function public.import_events(p_items jsonb, p_participants uuid[], p_visibility text, p_name text, p_color text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_family uuid := public.my_family();
  v_role text := public.my_role();
  v_item jsonb;
  v_x jsonb;
  v_id uuid;
  v_first uuid;
  v_import uuid;
  v_count int := 0;
  v_parts uuid[] := coalesce(p_participants, '{}'::uuid[]);
begin
  if v_family is null then raise exception 'Nicht angemeldet'; end if;
  if p_visibility not in ('family', 'parents', 'private') then raise exception 'Ungültige Sichtbarkeit'; end if;
  if p_visibility = 'parents' and v_role not in ('admin', 'parent') then raise exception 'Keine Berechtigung'; end if;
  if jsonb_array_length(p_items) > 2000 then raise exception 'Zu viele Termine auf einmal (höchstens 2000)'; end if;
  if p_visibility = 'private' then v_parts := '{}'; end if;

  perform set_config('fz.bulk', 'on', true);

  insert into public.calendar_imports (family_id, owner_id, name, color)
  values (v_family, auth.uid(), left(coalesce(nullif(trim(p_name), ''), 'Importierter Kalender'), 60), p_color)
  returning id into v_import;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.events (family_id, owner_id, title, description, location, starts_at, ends_at, all_day,
                               visibility, rrule, until, source, external_uid, color, import_id)
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
            left(nullif(v_item ->> 'external_uid', ''), 500),
            p_color, v_import)
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

  update public.calendar_imports set event_count = v_count where id = v_import;

  if v_first is not null then
    insert into public.notifications (user_id, type, title, body, url, push_state)
    select a, 'event_new',
           case when v_count = 1 then '1 Termin importiert' else v_count || ' Termine importiert' end,
           left(coalesce(nullif(trim(p_name), ''), 'Kalender'), 60) || ' · von ' || public.actor_name(), '#/kalender',
           case when public.push_wanted(a, 'event_new') then 'pending' else 'skipped' end
    from public.event_audience(v_first) as a
    where a is distinct from auth.uid();
  end if;
  return v_count;
end;
$$;

-- Name oder Farbe eines importierten Kalenders ändern
create function public.update_import(p_id uuid, p_name text, p_color text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.calendar_imports set name = left(trim(p_name), 60), color = p_color
   where id = p_id and owner_id = auth.uid();
  if not found then raise exception 'Keine Berechtigung'; end if;
  perform set_config('fz.bulk', 'on', true);
  update public.events set color = p_color where import_id = p_id;
end;
$$;

-- Importierten Kalender samt seiner Termine entfernen
create function public.delete_import(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.calendar_imports where id = p_id and owner_id = auth.uid()) then
    raise exception 'Keine Berechtigung';
  end if;
  perform set_config('fz.bulk', 'on', true);
  delete from public.calendar_imports where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Externe Kalender: Farbe beim Anlegen und Ändern
-- ---------------------------------------------------------------------
drop function public.add_feed(text, text, text, text, boolean);
drop function public.update_feed(uuid, text, text, boolean, boolean);

create function public.add_feed(p_label text, p_provider text, p_url text, p_visibility text, p_assign_me boolean, p_color text)
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
  insert into public.calendar_feeds (family_id, user_id, label, provider, visibility, assign_me, color)
  values (public.my_family(), auth.uid(), left(trim(p_label), 60), coalesce(p_provider, 'other'), p_visibility,
          coalesce(p_assign_me, true), coalesce(p_color, '#5B7FDB'))
  returning id into v_id;
  insert into public.calendar_feed_urls (feed_id, url) values (v_id, public.fz_feed_url(p_url));
  perform public.kick_push();
  return v_id;
end;
$$;

create function public.update_feed(p_id uuid, p_label text, p_visibility text, p_assign_me boolean, p_paused boolean, p_color text)
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
         color = coalesce(p_color, color),
         sync_requested = case when p_paused then false when f.paused then true else sync_requested end
   where id = p_id;

  perform set_config('fz.bulk', 'on', true);
  if p_visibility is distinct from f.visibility or coalesce(p_color, f.color) is distinct from f.color then
    update public.events set visibility = p_visibility, color = coalesce(p_color, f.color) where feed_id = p_id;
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
  public.import_events(jsonb, uuid[], text, text, text), public.update_import(uuid, text, text), public.delete_import(uuid),
  public.add_feed(text, text, text, text, boolean, text), public.update_feed(uuid, text, text, boolean, boolean, text),
  public.request_feed_sync(uuid), public.delete_feed(uuid)
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open()
  to anon, authenticated;
