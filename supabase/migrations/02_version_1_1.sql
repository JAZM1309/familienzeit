-- =====================================================================
-- Familienzeit – Datenbank Version 1.1: Kalender
-- Voraussetzung: 01_version_1_0.sql wurde ausgeführt.
-- Ausführen: SQL Editor → New query → einfügen → Run. Nur EINMAL.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete restrict,
  owner_id     uuid not null references auth.users(id) on delete restrict,
  title        text not null check (char_length(trim(title)) between 1 and 120),
  description  text check (description is null or char_length(description) <= 4000),
  location     text check (location is null or char_length(location) <= 200),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  all_day      boolean not null default false,
  visibility   text not null default 'family' check (visibility in ('family', 'parents', 'private')),
  rrule        text check (rrule is null or rrule ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=[1-9][0-9]{0,2})?(;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU)){0,6})?$'),
  until        date,
  source       text not null default 'manual' check (source in ('manual', 'ics', 'feed')),
  external_uid text check (external_uid is null or char_length(external_uid) <= 500),
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete restrict,
  check (ends_at >= starts_at),
  check (until is null or rrule is not null)
);
create index events_family_start on public.events (family_id, starts_at);

-- Zugeordnete Personen (keine Zuordnung = ganze Familie)
create table public.event_participants (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete restrict,
  primary key (event_id, user_id)
);
create index event_participants_user on public.event_participants (user_id);

-- Einzelne Termine einer Serie: abgesagt oder geändert
create table public.event_exceptions (
  event_id       uuid not null references public.events(id) on delete cascade,
  original_start timestamptz not null,
  cancelled      boolean not null default false,
  title          text check (title is null or char_length(trim(title)) between 1 and 120),
  description    text check (description is null or char_length(description) <= 4000),
  location       text check (location is null or char_length(location) <= 200),
  starts_at      timestamptz,
  ends_at        timestamptz,
  all_day        boolean,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete restrict,
  primary key (event_id, original_start),
  check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

-- Persönliche Erinnerungszeiten (Minuten vorher), versendet ab Version 1.2
create table public.event_reminders (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete restrict,
  offsets  int[] not null check (cardinality(offsets) between 1 and 6
                                 and 0 <= all (offsets) and 40320 >= all (offsets)),
  primary key (event_id, user_id)
);

-- Änderungsverlauf (nur durch Trigger beschrieben)
create table public.event_history (
  id        bigint generated always as identity primary key,
  event_id  uuid not null references public.events(id) on delete cascade,
  actor_id  uuid references auth.users(id) on delete restrict,
  at        timestamptz not null default now(),
  action    text not null,
  changes   jsonb
);
create index event_history_event on public.event_history (event_id, at);

-- ---------------------------------------------------------------------
-- Rechte-Funktionen
-- ---------------------------------------------------------------------

-- Sichtbar: Familie für alle, "Nur Eltern" für Admin + Elternteil,
-- "Persönlich" ausschließlich für den Besitzer (auch nicht für den Admin).
create function public.can_see_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event
      and e.family_id = public.my_family()
      and (   e.visibility = 'family'
           or (e.visibility = 'parents' and public.my_role() in ('admin', 'parent'))
           or (e.visibility = 'private' and e.owner_id = auth.uid()))
  )
$$;

-- Bearbeiten: wer ihn sieht UND (Ersteller ODER beteiligt ODER niemand zugeordnet)
create function public.can_edit_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_see_event(p_event) and exists (
    select 1 from public.events e
    where e.id = p_event
      and (   e.owner_id = auth.uid()
           or exists (select 1 from public.event_participants p where p.event_id = e.id and p.user_id = auth.uid())
           or not exists (select 1 from public.event_participants p where p.event_id = e.id))
  )
$$;

-- ---------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------

create function public.events_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
  else
    if new.visibility is distinct from old.visibility and auth.uid() is distinct from old.owner_id then
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

create trigger events_before before insert or update on public.events
  for each row execute function public.events_before();

create function public.events_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  diff jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.event_history (event_id, actor_id, action) values (new.id, auth.uid(), 'created');
    return new;
  end if;

  if new.title       is distinct from old.title       then diff := diff || jsonb_build_object('title', jsonb_build_array(old.title, new.title)); end if;
  if new.description is distinct from old.description then diff := diff || jsonb_build_object('description', true); end if;
  if new.location    is distinct from old.location    then diff := diff || jsonb_build_object('location', jsonb_build_array(old.location, new.location)); end if;
  if new.starts_at   is distinct from old.starts_at   then diff := diff || jsonb_build_object('starts_at', jsonb_build_array(old.starts_at, new.starts_at)); end if;
  if new.ends_at     is distinct from old.ends_at     then diff := diff || jsonb_build_object('ends_at', jsonb_build_array(old.ends_at, new.ends_at)); end if;
  if new.all_day     is distinct from old.all_day     then diff := diff || jsonb_build_object('all_day', jsonb_build_array(old.all_day, new.all_day)); end if;
  if new.visibility  is distinct from old.visibility  then diff := diff || jsonb_build_object('visibility', jsonb_build_array(old.visibility, new.visibility)); end if;
  if new.rrule       is distinct from old.rrule       then diff := diff || jsonb_build_object('rrule', jsonb_build_array(old.rrule, new.rrule)); end if;
  if new.until       is distinct from old.until       then diff := diff || jsonb_build_object('until', jsonb_build_array(old.until, new.until)); end if;

  if diff <> '{}'::jsonb then
    insert into public.event_history (event_id, actor_id, action, changes) values (new.id, auth.uid(), 'updated', diff);
  end if;

  -- Zuordnungen bereinigen, wenn die Sichtbarkeit enger wird
  if new.visibility = 'private' then
    delete from public.event_participants where event_id = new.id;
  elsif new.visibility = 'parents' then
    delete from public.event_participants p
    using public.members m
    where p.event_id = new.id and m.user_id = p.user_id and m.role = 'child';
  end if;
  return new;
end;
$$;

create trigger events_after after insert or update on public.events
  for each row execute function public.events_after();

-- Zuordnungen prüfen und protokollieren
create function public.participants_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.events%rowtype;
  r text;
begin
  select * into e from public.events where id = new.event_id;
  select role into r from public.members where user_id = new.user_id and family_id = e.family_id;
  if r is null then raise exception 'Person gehört nicht zur Familie'; end if;
  if e.visibility = 'private' then raise exception 'Persönliche Termine haben keine Zuordnung'; end if;
  if e.visibility = 'parents' and r = 'child' then raise exception 'Kinder können nicht zu Eltern-Terminen zugeordnet werden'; end if;
  return new;
end;
$$;

create trigger participants_check before insert on public.event_participants
  for each row execute function public.participants_check();

create function public.participants_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid := coalesce(new.event_id, old.event_id);
  v_user  uuid := coalesce(new.user_id, old.user_id);
  v_created timestamptz;
begin
  select created_at into v_created from public.events where id = v_event;
  -- Termin gelöscht oder gerade erst angelegt: nicht extra protokollieren
  if v_created is null or v_created = now() then return null; end if;
  insert into public.event_history (event_id, actor_id, action, changes)
  values (v_event, auth.uid(),
          case when tg_op = 'INSERT' then 'participant_added' else 'participant_removed' end,
          jsonb_build_object('user_id', v_user));
  return null;
end;
$$;

create trigger participants_log after insert or delete on public.event_participants
  for each row execute function public.participants_log();

create function public.exceptions_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger exceptions_before before insert or update on public.event_exceptions
  for each row execute function public.exceptions_before();

create function public.exceptions_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.events where id = new.event_id) then return null; end if;
  insert into public.event_history (event_id, actor_id, action, changes)
  values (new.event_id, auth.uid(),
          case when new.cancelled then 'instance_cancelled' else 'instance_changed' end,
          jsonb_build_object('original_start', new.original_start));
  return null;
end;
$$;

create trigger exceptions_log after insert or update on public.event_exceptions
  for each row execute function public.exceptions_log();

-- ---------------------------------------------------------------------
-- Zugriffsregeln
-- ---------------------------------------------------------------------

alter table public.events             enable row level security;
alter table public.event_participants enable row level security;
alter table public.event_exceptions   enable row level security;
alter table public.event_reminders    enable row level security;
alter table public.event_history      enable row level security;

revoke all on public.events, public.event_participants, public.event_exceptions,
              public.event_reminders, public.event_history from anon, authenticated;

grant select, delete on public.events to authenticated;
grant insert (family_id, owner_id, title, description, location, starts_at, ends_at, all_day, visibility, rrule, until)
  on public.events to authenticated;
grant update (title, description, location, starts_at, ends_at, all_day, visibility, rrule, until)
  on public.events to authenticated;

grant select, insert, delete on public.event_participants to authenticated;

grant select, delete on public.event_exceptions to authenticated;
grant insert (event_id, original_start, cancelled, title, description, location, starts_at, ends_at, all_day)
  on public.event_exceptions to authenticated;
grant update (cancelled, title, description, location, starts_at, ends_at, all_day)
  on public.event_exceptions to authenticated;

grant select, insert, update, delete on public.event_reminders to authenticated;
grant select on public.event_history to authenticated;

-- Termine
create policy events_select on public.events for select to authenticated
  using (
    family_id = (select public.my_family())
    and (   visibility = 'family'
         or (visibility = 'parents' and (select public.my_role()) in ('admin', 'parent'))
         or (visibility = 'private' and owner_id = (select auth.uid())))
  );
create policy events_insert on public.events for insert to authenticated
  with check (
    family_id = (select public.my_family())
    and owner_id = (select auth.uid())
    and (visibility <> 'parents' or (select public.my_role()) in ('admin', 'parent'))
  );
create policy events_update on public.events for update to authenticated
  using (public.can_edit_event(id))
  with check (
    family_id = (select public.my_family())
    and (visibility <> 'parents' or (select public.my_role()) in ('admin', 'parent'))
  );
create policy events_delete on public.events for delete to authenticated
  using (public.can_edit_event(id));

-- Zuordnungen
create policy participants_select on public.event_participants for select to authenticated
  using (public.can_see_event(event_id));
create policy participants_insert on public.event_participants for insert to authenticated
  with check (public.can_edit_event(event_id));
create policy participants_delete on public.event_participants for delete to authenticated
  using (public.can_edit_event(event_id));

-- Ausnahmen einer Serie
create policy exceptions_select on public.event_exceptions for select to authenticated
  using (public.can_see_event(event_id));
create policy exceptions_insert on public.event_exceptions for insert to authenticated
  with check (public.can_edit_event(event_id));
create policy exceptions_update on public.event_exceptions for update to authenticated
  using (public.can_edit_event(event_id)) with check (public.can_edit_event(event_id));
create policy exceptions_delete on public.event_exceptions for delete to authenticated
  using (public.can_edit_event(event_id));

-- Erinnerungen: nur die eigenen
create policy reminders_all on public.event_reminders for all to authenticated
  using (user_id = (select auth.uid()) and public.can_see_event(event_id))
  with check (user_id = (select auth.uid()) and public.can_see_event(event_id));

-- Verlauf: sichtbar wie der Termin selbst
create policy history_select on public.event_history for select to authenticated
  using (public.can_see_event(event_id));

-- ---------------------------------------------------------------------
-- Funktionen für die App (laufen mit den Rechten des Aufrufers)
-- ---------------------------------------------------------------------

-- Termine (inkl. Serien) für einen Zeitraum
create function public.events_in_range(p_from timestamptz, p_to timestamptz)
returns setof public.events
language sql stable security invoker set search_path = '' as $$
  select * from public.events e
  where e.starts_at < p_to
    and (   (e.rrule is null and e.ends_at > p_from)
         or (e.rrule is not null and (e.until is null or e.until >= (p_from - interval '2 days')::date)))
$$;

-- Termin anlegen oder ändern, inkl. Zuordnungen und eigener Erinnerungen
create function public.save_event(
  p_id uuid, p_version int, p_data jsonb, p_participants uuid[], p_reminders int[]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id    uuid;
  v_parts uuid[] := coalesce(p_participants, '{}'::uuid[]);
begin
  if p_id is null then
    insert into public.events (family_id, owner_id, title, description, location,
                               starts_at, ends_at, all_day, visibility, rrule, until)
    values (public.my_family(), auth.uid(),
            trim(p_data ->> 'title'),
            nullif(trim(p_data ->> 'description'), ''),
            nullif(trim(p_data ->> 'location'), ''),
            (p_data ->> 'starts_at')::timestamptz,
            (p_data ->> 'ends_at')::timestamptz,
            coalesce((p_data ->> 'all_day')::boolean, false),
            coalesce(p_data ->> 'visibility', 'family'),
            nullif(p_data ->> 'rrule', ''),
            nullif(p_data ->> 'until', '')::date)
    returning id into v_id;
  else
    if not public.can_edit_event(p_id) then
      raise exception 'Keine Berechtigung für diesen Termin';
    end if;
    update public.events set
      title       = trim(p_data ->> 'title'),
      description = nullif(trim(p_data ->> 'description'), ''),
      location    = nullif(trim(p_data ->> 'location'), ''),
      starts_at   = (p_data ->> 'starts_at')::timestamptz,
      ends_at     = (p_data ->> 'ends_at')::timestamptz,
      all_day     = coalesce((p_data ->> 'all_day')::boolean, false),
      visibility  = coalesce(p_data ->> 'visibility', 'family'),
      rrule       = nullif(p_data ->> 'rrule', ''),
      until       = nullif(p_data ->> 'until', '')::date
    where id = p_id and version = p_version
    returning id into v_id;
    if v_id is null then
      raise exception 'Konflikt: Der Termin wurde inzwischen geändert';
    end if;
  end if;

  delete from public.event_participants
  where event_id = v_id and not (user_id = any (v_parts));
  insert into public.event_participants (event_id, user_id)
  select v_id, u from unnest(v_parts) as u
  on conflict do nothing;

  if p_reminders is null or cardinality(p_reminders) = 0 then
    delete from public.event_reminders where event_id = v_id and user_id = auth.uid();
  else
    insert into public.event_reminders (event_id, user_id, offsets)
    values (v_id, auth.uid(), p_reminders)
    on conflict (event_id, user_id) do update set offsets = excluded.offsets;
  end if;

  return v_id;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_family(), public.my_role(), public.is_admin(),
  public.create_invitation(text), public.revoke_invitation(uuid),
  public.can_see_event(uuid), public.can_edit_event(uuid),
  public.events_in_range(timestamptz, timestamptz),
  public.save_event(uuid, int, jsonb, uuid[], int[])
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open()
  to anon, authenticated;

-- Fertig. Erwartete Meldung: "Success. No rows returned"
