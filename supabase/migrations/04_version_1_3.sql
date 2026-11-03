-- =====================================================================
-- Familienzeit – Datenbank Version 1.3: Aufgaben, Kommentare, Anhänge
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Aufgaben
-- ---------------------------------------------------------------------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete restrict,
  owner_id    uuid not null references auth.users(id) on delete restrict,
  title       text not null check (char_length(trim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 4000),
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status      text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  due_at      timestamptz,
  due_all_day boolean not null default true,
  done_at     timestamptz,
  done_by     uuid references auth.users(id) on delete restrict,
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete restrict
);
create index tasks_family_status on public.tasks (family_id, status, due_at);

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  primary key (task_id, user_id)
);
create index task_assignees_user on public.task_assignees (user_id);

-- Persönliche Erinnerungen (Minuten vor der Fälligkeit; 0 = bei Fälligkeit)
create table public.task_reminders (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  offsets int[] not null check (cardinality(offsets) between 1 and 6
                                and 0 <= all (offsets) and 40320 >= all (offsets)),
  primary key (task_id, user_id)
);

create table public.task_history (
  id        bigint generated always as identity primary key,
  task_id   uuid not null references public.tasks(id) on delete cascade,
  actor_id  uuid references auth.users(id) on delete restrict,
  at        timestamptz not null default now(),
  action    text not null,
  changes   jsonb
);
create index task_history_task on public.task_history (task_id, at);

create table public.task_reminder_log (
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete restrict,
  due_at     timestamptz not null,
  offset_min int not null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id, due_at, offset_min)
);
alter table public.task_reminder_log enable row level security;
revoke all on public.task_reminder_log from anon, authenticated;

-- ---------------------------------------------------------------------
-- Kommentare und Anhänge (an einem Termin ODER einer Aufgabe)
-- ---------------------------------------------------------------------
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete restrict,
  event_id   uuid references public.events(id) on delete cascade,
  task_id    uuid references public.tasks(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete restrict,
  body       text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  check (num_nonnulls(event_id, task_id) = 1)
);
create index comments_event on public.comments (event_id, created_at);
create index comments_task on public.comments (task_id, created_at);

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete restrict,
  event_id     uuid references public.events(id) on delete cascade,
  task_id      uuid references public.tasks(id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  file_name    text not null check (char_length(file_name) between 1 and 200),
  mime         text not null check (mime in ('image/webp', 'image/jpeg', 'image/png', 'application/pdf')),
  size_bytes   int not null check (size_bytes between 1 and 5242880),
  uploaded_by  uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now(),
  check (num_nonnulls(event_id, task_id) = 1)
);
create index attachments_event on public.attachments (event_id);
create index attachments_task on public.attachments (task_id);

-- ---------------------------------------------------------------------
-- Rechte-Funktionen
-- ---------------------------------------------------------------------
create function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t where t.id = p_task and t.family_id = public.my_family())
$$;

-- Bearbeiten: Ersteller, zugewiesene Personen oder alle bei Familienaufgaben
create function public.can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_see_task(p_task) and exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (   t.owner_id = auth.uid()
           or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = auth.uid())
           or not exists (select 1 from public.task_assignees a where a.task_id = t.id))
  )
$$;

create function public.can_see_target(p_event uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_event is not null then public.can_see_event(p_event)
              when p_task is not null then public.can_see_task(p_task)
              else false end
$$;

create function public.can_edit_target(p_event uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_event is not null then public.can_edit_event(p_event)
              when p_task is not null then public.can_edit_task(p_task)
              else false end
$$;

-- ---------------------------------------------------------------------
-- Trigger Aufgaben
-- ---------------------------------------------------------------------
create function public.tasks_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
  else
    new.version := old.version + 1;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.status <> 'done' then
    new.done_at := null;
    new.done_by := null;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger tasks_before before insert or update on public.tasks
  for each row execute function public.tasks_before();

create function public.tasks_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  diff jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.task_history (task_id, actor_id, action) values (new.id, auth.uid(), 'created');
    return new;
  end if;
  if new.title       is distinct from old.title       then diff := diff || jsonb_build_object('title', jsonb_build_array(old.title, new.title)); end if;
  if new.description is distinct from old.description then diff := diff || jsonb_build_object('description', true); end if;
  if new.priority    is distinct from old.priority    then diff := diff || jsonb_build_object('priority', jsonb_build_array(old.priority, new.priority)); end if;
  if new.status      is distinct from old.status      then diff := diff || jsonb_build_object('status', jsonb_build_array(old.status, new.status)); end if;
  if new.due_at      is distinct from old.due_at or new.due_all_day is distinct from old.due_all_day then
    diff := diff || jsonb_build_object('due_at', jsonb_build_array(old.due_at, new.due_at));
  end if;
  if diff <> '{}'::jsonb then
    insert into public.task_history (task_id, actor_id, action, changes) values (new.id, auth.uid(), 'updated', diff);
  end if;
  return new;
end;
$$;

create trigger tasks_after after insert or update on public.tasks
  for each row execute function public.tasks_after();

create function public.task_assignees_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.members m join public.tasks t on t.family_id = m.family_id
    where t.id = new.task_id and m.user_id = new.user_id
  ) then
    raise exception 'Person gehört nicht zur Familie';
  end if;
  return new;
end;
$$;

create trigger task_assignees_check before insert on public.task_assignees
  for each row execute function public.task_assignees_check();

-- Zuordnung protokollieren und den neu Zugeordneten benachrichtigen
create function public.task_assignees_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_task uuid := coalesce(new.task_id, old.task_id);
  v_user uuid := coalesce(new.user_id, old.user_id);
  t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = v_task;
  if not found or t.created_at = now() then return null; end if;
  insert into public.task_history (task_id, actor_id, action, changes)
  values (v_task, auth.uid(), case when tg_op = 'INSERT' then 'assignee_added' else 'assignee_removed' end,
          jsonb_build_object('user_id', v_user));
  if tg_op = 'INSERT' and v_user is distinct from auth.uid() then
    insert into public.notifications (user_id, type, title, body, url, push_state)
    values (v_user, 'task_assigned', 'Aufgabe für dich: ' || t.title, 'von ' || public.actor_name(),
            '#/aufgabe?id=' || t.id,
            case when public.push_wanted(v_user, 'task_assigned') then 'pending' else 'skipped' end);
  end if;
  return null;
end;
$$;

create trigger task_assignees_log after insert or delete on public.task_assignees
  for each row execute function public.task_assignees_log();

-- ---------------------------------------------------------------------
-- Benachrichtigungen erweitern
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'event_new', 'event_changed', 'event_cancelled', 'event_deleted', 'reminder', 'test',
  'task_new', 'task_assigned', 'task_done', 'task_reminder', 'comment_new'));
alter table public.notifications add column task_id uuid references public.tasks(id) on delete set null;

create or replace function public.push_wanted(p_user uuid, p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (m.settings -> 'notify' ->> case
              when p_type in ('event_changed', 'event_cancelled', 'event_deleted') then 'event_changed'
              when p_type in ('task_new', 'task_assigned', 'task_done') then 'task'
              when p_type = 'task_reminder' then 'reminder'
              when p_type = 'comment_new' then 'comment'
              else p_type end) is distinct from 'false'
    from public.members m where m.user_id = p_user), true)
$$;

create function public.fz_due_text(p_due timestamptz, p_all_day boolean) returns text
language sql stable set search_path = '' as $$
  select case when p_due is null then 'ohne Termin'
    else 'fällig ' || (array['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'])[extract(dow from p_due at time zone 'Europe/Berlin')::int + 1]
         || '., ' || to_char(p_due at time zone 'Europe/Berlin', 'DD.MM.')
         || case when p_all_day then '' else ' ' || to_char(p_due at time zone 'Europe/Berlin', 'HH24:MI') end
  end
$$;

-- Neue Aufgabe und erledigte Aufgabe (am Ende der Transaktion)
create function public.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.task_assignees where task_id = new.id) then
      insert into public.notifications (user_id, type, title, body, url, task_id, push_state)
      select a.user_id, 'task_assigned', 'Aufgabe für dich: ' || new.title,
             public.fz_due_text(new.due_at, new.due_all_day) || ' · von ' || public.actor_name(),
             '#/aufgabe?id=' || new.id, new.id,
             case when public.push_wanted(a.user_id, 'task_assigned') then 'pending' else 'skipped' end
      from public.task_assignees a where a.task_id = new.id and a.user_id is distinct from auth.uid();
    else
      insert into public.notifications (user_id, type, title, body, url, task_id, push_state)
      select m.user_id, 'task_new', 'Neue Aufgabe: ' || new.title,
             public.fz_due_text(new.due_at, new.due_all_day) || ' · von ' || public.actor_name(),
             '#/aufgabe?id=' || new.id, new.id,
             case when public.push_wanted(m.user_id, 'task_new') then 'pending' else 'skipped' end
      from public.members m where m.family_id = new.family_id and m.user_id is distinct from auth.uid();
    end if;
    return null;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    insert into public.notifications (user_id, type, title, body, url, task_id, push_state)
    select u, 'task_done', 'Erledigt: ' || new.title, 'von ' || public.actor_name(),
           '#/aufgabe?id=' || new.id, new.id,
           case when public.push_wanted(u, 'task_done') then 'pending' else 'skipped' end
    from (select new.owner_id as u union select user_id from public.task_assignees where task_id = new.id) x
    where u is distinct from auth.uid();
  end if;
  return null;
end;
$$;

create constraint trigger tasks_notify
  after insert or update on public.tasks
  deferrable initially deferred
  for each row execute function public.tasks_notify();

-- Neuer Kommentar: alle, die den Eintrag sehen, außer dem Verfasser
create function public.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_url text;
  v_preview text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 120);
begin
  if new.event_id is not null then
    select title, public.fz_day_url(starts_at) into v_title, v_url from public.events where id = new.event_id;
    insert into public.notifications (user_id, type, title, body, url, event_id, push_state)
    select a, 'comment_new', 'Kommentar zu „' || v_title || '“', public.actor_name() || ': ' || v_preview, v_url, new.event_id,
           case when public.push_wanted(a, 'comment_new') then 'pending' else 'skipped' end
    from public.event_audience(new.event_id) as a where a is distinct from new.author_id;
  else
    select title into v_title from public.tasks where id = new.task_id;
    insert into public.notifications (user_id, type, title, body, url, task_id, push_state)
    select m.user_id, 'comment_new', 'Kommentar zu „' || v_title || '“', public.actor_name() || ': ' || v_preview,
           '#/aufgabe?id=' || new.task_id, new.task_id,
           case when public.push_wanted(m.user_id, 'comment_new') then 'pending' else 'skipped' end
    from public.members m where m.family_id = new.family_id and m.user_id is distinct from new.author_id;
  end if;
  return null;
end;
$$;

create trigger comments_notify after insert on public.comments
  for each row execute function public.comments_notify();

-- Für die Push-Funktion: Erinnerung an eine fällige Aufgabe
create function public.add_task_reminder(
  p_task uuid, p_user uuid, p_due timestamptz, p_offset int, p_title text, p_body text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  if not exists (
    select 1 from public.tasks t join public.members m on m.family_id = t.family_id
    where t.id = p_task and m.user_id = p_user and t.status <> 'done'
  ) then return false; end if;
  insert into public.task_reminder_log (task_id, user_id, due_at, offset_min)
  values (p_task, p_user, p_due, p_offset) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  insert into public.notifications (user_id, type, title, body, url, task_id, push_state)
  values (p_user, 'task_reminder', p_title, p_body, '#/aufgabe?id=' || p_task, p_task,
          case when public.push_wanted(p_user, 'task_reminder') then 'pending' else 'skipped' end);
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Zugriffsregeln
-- ---------------------------------------------------------------------
alter table public.tasks          enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_reminders enable row level security;
alter table public.task_history   enable row level security;
alter table public.comments       enable row level security;
alter table public.attachments    enable row level security;

revoke all on public.tasks, public.task_assignees, public.task_reminders, public.task_history,
              public.comments, public.attachments from anon, authenticated;

grant select, delete on public.tasks to authenticated;
grant insert (family_id, owner_id, title, description, priority, status, due_at, due_all_day) on public.tasks to authenticated;
grant update (title, description, priority, status, due_at, due_all_day) on public.tasks to authenticated;
grant select, insert, delete on public.task_assignees to authenticated;
grant select, insert, update, delete on public.task_reminders to authenticated;
grant select on public.task_history to authenticated;
grant select, delete on public.comments to authenticated;
grant insert (family_id, event_id, task_id, author_id, body) on public.comments to authenticated;
grant update (body, edited_at) on public.comments to authenticated;
grant select, delete on public.attachments to authenticated;
grant insert (family_id, event_id, task_id, storage_path, file_name, mime, size_bytes, uploaded_by) on public.attachments to authenticated;

create policy tasks_select on public.tasks for select to authenticated
  using (family_id = (select public.my_family()));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (family_id = (select public.my_family()) and owner_id = (select auth.uid()));
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_edit_task(id)) with check (family_id = (select public.my_family()));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.can_edit_task(id));

create policy task_assignees_select on public.task_assignees for select to authenticated
  using (public.can_see_task(task_id));
create policy task_assignees_insert on public.task_assignees for insert to authenticated
  with check (public.can_edit_task(task_id));
create policy task_assignees_delete on public.task_assignees for delete to authenticated
  using (public.can_edit_task(task_id));

create policy task_reminders_all on public.task_reminders for all to authenticated
  using (user_id = (select auth.uid()) and public.can_see_task(task_id))
  with check (user_id = (select auth.uid()) and public.can_see_task(task_id));

create policy task_history_select on public.task_history for select to authenticated
  using (public.can_see_task(task_id));

-- Kommentare: sehen und schreiben, wer den Eintrag sieht; ändern/löschen nur der Verfasser
create policy comments_select on public.comments for select to authenticated
  using (public.can_see_target(event_id, task_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and family_id = (select public.my_family())
              and public.can_see_target(event_id, task_id));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select auth.uid()));

-- Anhänge: hinzufügen, wer den Eintrag sieht; löschen der Hochlader oder wer den Eintrag bearbeiten darf
create policy attachments_select on public.attachments for select to authenticated
  using (public.can_see_target(event_id, task_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (
    uploaded_by = (select auth.uid()) and family_id = (select public.my_family())
    and public.can_see_target(event_id, task_id)
    and storage_path like (select public.my_family())::text || '/' ||
        case when event_id is not null then 'events/' || event_id else 'tasks/' || task_id end || '/%'
  );
create policy attachments_delete on public.attachments for delete to authenticated
  using (uploaded_by = (select auth.uid()) or public.can_edit_target(event_id, task_id));

-- ---------------------------------------------------------------------
-- Dateispeicher: <family_id>/events/<event_id>/<datei> bzw. tasks/<task_id>/<datei>
-- ---------------------------------------------------------------------
create function public.storage_target(p_name text, out event_id uuid, out task_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := string_to_array(p_name, '/');
begin
  if cardinality(parts) <> 4 or parts[1] is distinct from public.my_family()::text
     or parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;
  if parts[2] = 'events' then event_id := parts[3]::uuid;
  elsif parts[2] = 'tasks' then task_id := parts[3]::uuid;
  end if;
end;
$$;

create function public.storage_can_upload(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.can_see_target(t.event_id, t.task_id), false) from public.storage_target(p_name) t
$$;

-- Lesen nur, wenn die Datei als Anhang eingetragen ist und der Eintrag sichtbar ist
create function public.storage_can_read(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.attachments a
    where a.storage_path = p_name and a.family_id = public.my_family()
      and public.can_see_target(a.event_id, a.task_id))
$$;

create function public.storage_can_delete(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.attachments a where a.storage_path = p_name) then exists (
      select 1 from public.attachments a where a.storage_path = p_name
        and (a.uploaded_by = auth.uid() or public.can_edit_target(a.event_id, a.task_id)))
    else public.storage_can_upload(p_name)   -- verwaiste Datei (z. B. abgebrochener Upload)
  end
$$;

create policy familie_files_read on storage.objects for select to authenticated
  using (bucket_id = 'familie' and public.storage_can_read(name));
create policy familie_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'familie' and public.storage_can_upload(name));
create policy familie_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'familie' and public.storage_can_delete(name));

-- ---------------------------------------------------------------------
-- Funktionen für die App
-- ---------------------------------------------------------------------
create function public.save_task(
  p_id uuid, p_version int, p_data jsonb, p_assignees uuid[], p_reminders int[]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_ass uuid[] := coalesce(p_assignees, '{}'::uuid[]);
begin
  if p_id is null then
    insert into public.tasks (family_id, owner_id, title, description, priority, status, due_at, due_all_day)
    values (public.my_family(), auth.uid(), trim(p_data ->> 'title'),
            nullif(trim(p_data ->> 'description'), ''),
            coalesce(p_data ->> 'priority', 'normal'), coalesce(p_data ->> 'status', 'open'),
            nullif(p_data ->> 'due_at', '')::timestamptz,
            coalesce((p_data ->> 'due_all_day')::boolean, true))
    returning id into v_id;
  else
    if not public.can_edit_task(p_id) then
      raise exception 'Keine Berechtigung für diese Aufgabe';
    end if;
    update public.tasks set
      title = trim(p_data ->> 'title'),
      description = nullif(trim(p_data ->> 'description'), ''),
      priority = coalesce(p_data ->> 'priority', 'normal'),
      status = coalesce(p_data ->> 'status', status),
      due_at = nullif(p_data ->> 'due_at', '')::timestamptz,
      due_all_day = coalesce((p_data ->> 'due_all_day')::boolean, true)
    where id = p_id and version = p_version
    returning id into v_id;
    if v_id is null then raise exception 'Konflikt: Die Aufgabe wurde inzwischen geändert'; end if;
  end if;

  delete from public.task_assignees where task_id = v_id and not (user_id = any (v_ass));
  insert into public.task_assignees (task_id, user_id) select v_id, u from unnest(v_ass) as u on conflict do nothing;

  if p_reminders is null or cardinality(p_reminders) = 0 then
    delete from public.task_reminders where task_id = v_id and user_id = auth.uid();
  else
    insert into public.task_reminders (task_id, user_id, offsets) values (v_id, auth.uid(), p_reminders)
    on conflict (task_id, user_id) do update set offsets = excluded.offsets;
  end if;
  return v_id;
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
  public.save_task(uuid, int, jsonb, uuid[], int[])
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open()
  to anon, authenticated;
