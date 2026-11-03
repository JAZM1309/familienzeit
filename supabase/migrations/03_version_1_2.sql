-- =====================================================================
-- Familienzeit – Datenbank Version 1.2: Benachrichtigungen und Erinnerungen
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------
-- Interne Einstellungen für den Versand (für die App unsichtbar)
-- ---------------------------------------------------------------------
create table public.push_config (
  id            int primary key default 1 check (id = 1),
  secret        text not null,
  vapid_public  text,
  vapid_private jsonb,
  updated_at    timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
insert into public.push_config (secret) values (encode(extensions.gen_random_bytes(32), 'hex'));

-- ---------------------------------------------------------------------
-- Push-Abonnements der Geräte
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete restrict,
  endpoint        text not null unique check (char_length(endpoint) <= 1000),
  p256dh          text not null check (char_length(p256dh) <= 200),
  auth            text not null check (char_length(auth) <= 100),
  device_label    text check (device_label is null or char_length(device_label) <= 80),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  fail_count      int not null default 0
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
create policy push_subs_own_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subs_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Benachrichtigungen (Glocke) – jeder sieht nur seine eigenen
-- ---------------------------------------------------------------------
create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete restrict,
  type       text not null check (type in ('event_new', 'event_changed', 'event_cancelled', 'event_deleted', 'reminder', 'test')),
  title      text not null,
  body       text,
  url        text,
  event_id   uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  push_state text not null default 'pending' check (push_state in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  pushed_at  timestamptz
);
create index notifications_user_created on public.notifications (user_id, created_at desc);
create index notifications_pending on public.notifications (id) where push_state = 'pending';
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_own_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_own_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Bereits verschickte Erinnerungen (verhindert Doppelte)
create table public.reminder_log (
  event_id         uuid not null references public.events(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete restrict,
  occurrence_start timestamptz not null,
  offset_min       int not null,
  created_at       timestamptz not null default now(),
  primary key (event_id, user_id, occurrence_start, offset_min)
);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- ---------------------------------------------------------------------
-- Hilfsfunktionen für Texte
-- ---------------------------------------------------------------------
create function public.fz_when(p_start timestamptz, p_all_day boolean, p_series boolean)
returns text language sql stable set search_path = '' as $$
  select (case when p_series then 'ab ' else '' end)
      || (array['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'])[extract(dow from p_start at time zone 'Europe/Berlin')::int + 1]
      || '., ' || to_char(p_start at time zone 'Europe/Berlin', 'DD.MM.')
      || case when p_all_day then ' · ganztägig' else ' · ' || to_char(p_start at time zone 'Europe/Berlin', 'HH24:MI') end
$$;

create function public.fz_day_url(p_start timestamptz)
returns text language sql stable set search_path = '' as $$
  select '#/kalender?v=day&d=' || to_char(p_start at time zone 'Europe/Berlin', 'YYYY-MM-DD')
$$;

-- Wer darf den Termin sehen?
create function public.event_audience(p_event uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.user_id
  from public.events e
  join public.members m on m.family_id = e.family_id
  where e.id = p_event
    and (   e.visibility = 'family'
         or (e.visibility = 'parents' and m.role in ('admin', 'parent'))
         or (e.visibility = 'private' and m.user_id = e.owner_id))
$$;

-- Push nur, wenn der Typ in den persönlichen Einstellungen nicht abgeschaltet ist
create function public.push_wanted(p_user uuid, p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (m.settings -> 'notify' ->> case
              when p_type in ('event_changed', 'event_cancelled', 'event_deleted') then 'event_changed'
              else p_type end) is distinct from 'false'
    from public.members m where m.user_id = p_user), true)
$$;

-- Benachrichtigung für alle Berechtigten außer dem Auslöser anlegen
create function public.notify_audience(p_event uuid, p_type text, p_title text, p_body text, p_url text, p_link_event boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, title, body, url, event_id, push_state)
  select a, p_type, p_title, p_body, p_url, case when p_link_event then p_event end,
         case when public.push_wanted(a, p_type) then 'pending' else 'skipped' end
  from public.event_audience(p_event) as a
  where a is distinct from auth.uid();
end;
$$;

create function public.actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select display_name from public.members where user_id = auth.uid()), 'Jemand')
$$;

-- ---------------------------------------------------------------------
-- Auslöser: neue, geänderte, abgesagte und gelöschte Termine
-- (am Ende der Transaktion, damit Zuordnungen schon gespeichert sind)
-- ---------------------------------------------------------------------
create function public.events_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  what text[] := '{}';
begin
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

create constraint trigger events_notify
  after insert or update on public.events
  deferrable initially deferred
  for each row execute function public.events_notify();

create function public.exceptions_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.events%rowtype;
  v_start timestamptz := coalesce(new.starts_at, new.original_start);
begin
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

create constraint trigger exceptions_notify
  after insert or update on public.event_exceptions
  deferrable initially deferred
  for each row execute function public.exceptions_notify();

create function public.events_notify_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_audience(old.id,
    'event_deleted', (case when old.rrule is not null then 'Serie gelöscht: ' else 'Termin gelöscht: ' end) || old.title,
    public.fz_when(old.starts_at, old.all_day, old.rrule is not null) || ' · von ' || public.actor_name(),
    '#/kalender', false);
  return old;
end;
$$;

create trigger events_notify_delete before delete on public.events
  for each row execute function public.events_notify_delete();

-- Sichtbarkeit enger gestellt: alte Meldungen und Erinnerungen der anderen entfernen
create function public.events_privacy_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility is distinct from old.visibility then
    delete from public.notifications n
    where n.event_id = new.id and not (n.user_id in (select public.event_audience(new.id)));
    delete from public.event_reminders r
    where r.event_id = new.id and not (r.user_id in (select public.event_audience(new.id)));
  end if;
  return null;
end;
$$;

create trigger events_privacy_cleanup after update of visibility on public.events
  for each row execute function public.events_privacy_cleanup();

-- ---------------------------------------------------------------------
-- Versand anstoßen: sofort bei neuen Meldungen und jede Minute (Erinnerungen)
-- ---------------------------------------------------------------------
create function public.kick_push() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
begin
  select secret into v_secret from public.push_config where id = 1;
  perform net.http_post(
    url := 'https://wvvcudtqzoolpwltidxo.supabase.co/functions/v1/push',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fz-secret', v_secret),
    timeout_milliseconds := 10000);
end;
$$;

create function public.notifications_kick() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from new_rows where push_state = 'pending') then
    perform public.kick_push();
  end if;
  return null;
end;
$$;

create trigger notifications_kick after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function public.notifications_kick();

select cron.unschedule(jobid) from cron.job where jobname = 'familienzeit-push';
select cron.schedule('familienzeit-push', '* * * * *', 'select public.kick_push()');

-- ---------------------------------------------------------------------
-- Für die Push-Funktion (läuft mit Datenbankrechten, nicht über die App)
-- ---------------------------------------------------------------------
create function public.add_reminder(
  p_event uuid, p_user uuid, p_occurrence timestamptz, p_offset int, p_title text, p_body text, p_url text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  -- nur, wenn die Person den Termin (noch) sehen darf
  if not (p_user in (select public.event_audience(p_event))) then return false; end if;
  insert into public.reminder_log (event_id, user_id, occurrence_start, offset_min)
  values (p_event, p_user, p_occurrence, p_offset)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  insert into public.notifications (user_id, type, title, body, url, event_id, push_state)
  values (p_user, 'reminder', p_title, p_body, p_url, p_event,
          case when public.push_wanted(p_user, 'reminder') then 'pending' else 'skipped' end);
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Für die App
-- ---------------------------------------------------------------------
create function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select vapid_public from public.push_config where id = 1
$$;

create function public.register_push(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.my_family() is null then raise exception 'Nicht angemeldet'; end if;
  -- Gleiches Gerät, anderes Konto: altes Abo entfernen, damit niemand fremde Meldungen bekommt
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_label, 80));
end;
$$;

create function public.unregister_push(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

create function public.send_test_push() returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, title, body, url)
  values (auth.uid(), 'test', 'Familienzeit', 'Benachrichtigungen funktionieren auf diesem Gerät.', '#/meldungen')
$$;

-- Funktionsrechte neu setzen
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_family(), public.my_role(), public.is_admin(),
  public.create_invitation(text), public.revoke_invitation(uuid),
  public.can_see_event(uuid), public.can_edit_event(uuid),
  public.events_in_range(timestamptz, timestamptz),
  public.save_event(uuid, int, jsonb, uuid[], int[]),
  public.push_public_key(), public.register_push(text, text, text, text),
  public.unregister_push(text), public.send_test_push()
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open()
  to anon, authenticated;
