-- =====================================================================
-- Familienzeit – Datenbank Version 2.2.0: Kalenderdatei als Aufgaben importieren
-- (z. B. Abfallkalender: aus jedem Abholtermin wird „Tonne rausstellen“)
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

-- Ein Import enthält entweder Termine oder Aufgaben
alter table public.calendar_imports
  add column kind text not null default 'events' check (kind in ('events', 'tasks'));

-- Aufgaben merken sich, aus welchem Import sie stammen (Import löschen = Aufgaben weg)
alter table public.tasks
  add column import_id uuid references public.calendar_imports(id) on delete cascade;
create index tasks_import on public.tasks (import_id) where import_id is not null;

-- Beim Sammelimport keine Einzelmeldung je Aufgabe (sonst kämen z. B. 80 Push-Nachrichten)
create or replace function public.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if public.fz_bulk() then return null; end if;
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

-- Aufgaben aus einer Kalenderdatei anlegen
-- p_items: [{ title, description, due_at, due_all_day }]
create function public.import_tasks(p_items jsonb, p_assignees uuid[], p_reminders int[], p_name text, p_color text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_family uuid := public.my_family();
  v_item jsonb;
  v_id uuid;
  v_import uuid;
  v_count int := 0;
  v_ass uuid[] := coalesce(p_assignees, '{}'::uuid[]);
  v_rem int[] := coalesce(p_reminders, '{}'::int[]);
begin
  if v_family is null then raise exception 'Nicht angemeldet'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Ungültige Daten'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'Zu viele Aufgaben auf einmal (höchstens 500)'; end if;
  if cardinality(v_rem) > 6 then raise exception 'Höchstens 6 Erinnerungen'; end if;
  if exists (select 1 from unnest(v_ass) u where u not in (select m.user_id from public.members m where m.family_id = v_family)) then
    raise exception 'Person gehört nicht zur Familie';
  end if;

  perform set_config('fz.bulk', 'on', true);

  insert into public.calendar_imports (family_id, owner_id, name, color, kind)
  values (v_family, auth.uid(), left(coalesce(nullif(trim(p_name), ''), 'Importierte Aufgaben'), 60), p_color, 'tasks')
  returning id into v_import;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.tasks (family_id, owner_id, title, description, priority, status, due_at, due_all_day, import_id)
    values (v_family, auth.uid(),
            left(coalesce(nullif(trim(v_item ->> 'title'), ''), '(ohne Titel)'), 120),
            left(nullif(trim(v_item ->> 'description'), ''), 4000),
            'normal', 'open',
            (v_item ->> 'due_at')::timestamptz,
            coalesce((v_item ->> 'due_all_day')::boolean, false),
            v_import)
    returning id into v_id;

    insert into public.task_assignees (task_id, user_id)
    select v_id, u from unnest(v_ass) as u on conflict do nothing;

    if cardinality(v_rem) > 0 and (v_item ->> 'due_at') is not null then
      insert into public.task_reminders (task_id, user_id, offsets) values (v_id, auth.uid(), v_rem);
    end if;
    v_count := v_count + 1;
  end loop;

  update public.calendar_imports set event_count = v_count where id = v_import;

  -- Eine einzige Meldung an die anderen
  if v_count > 0 then
    insert into public.notifications (user_id, type, title, body, url, push_state)
    select m.user_id, 'task_new',
           case when v_count = 1 then '1 Aufgabe importiert' else v_count || ' Aufgaben importiert' end,
           left(coalesce(nullif(trim(p_name), ''), 'Kalender'), 60) || ' · von ' || public.actor_name(), '#/aufgaben',
           case when public.push_wanted(m.user_id, 'task_new') then 'pending' else 'skipped' end
    from public.members m
    where m.family_id = v_family and m.user_id is distinct from auth.uid()
      and (cardinality(v_ass) = 0 or m.user_id = any (v_ass));
  end if;
  return v_count;
end;
$$;

revoke execute on function public.import_tasks(jsonb, uuid[], int[], text, text) from public, anon;
grant execute on function public.import_tasks(jsonb, uuid[], int[], text, text) to authenticated;
