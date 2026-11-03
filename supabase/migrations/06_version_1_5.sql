-- =====================================================================
-- Familienzeit – Datenbank Version 1.5: Einkaufsliste
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

create table public.shopping_items (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete restrict,
  name       text not null check (char_length(trim(name)) between 1 and 100),
  quantity   text check (quantity is null or char_length(quantity) <= 20),
  unit       text check (unit is null or char_length(unit) <= 20),
  category   text not null default 'sonstiges' check (category in (
               'obst', 'milch', 'fleisch', 'brot', 'getraenke', 'tiefkuehl', 'suess', 'haushalt', 'sonstiges')),
  added_by   uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  done       boolean not null default false,
  done_at    timestamptz,
  done_by    uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create index shopping_items_family on public.shopping_items (family_id, done, created_at);

create function public.shopping_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.done and not old.done then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif not new.done then
    new.done_at := null;
    new.done_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger shopping_before before update on public.shopping_items
  for each row execute function public.shopping_before();

alter table public.shopping_items enable row level security;
revoke all on public.shopping_items from anon, authenticated;
grant select, delete on public.shopping_items to authenticated;
grant insert (family_id, name, quantity, unit, category, added_by) on public.shopping_items to authenticated;
grant update (name, quantity, unit, category, done) on public.shopping_items to authenticated;

-- Eine gemeinsame Liste: alle in der Familie dürfen alles
create policy shopping_select on public.shopping_items for select to authenticated
  using (family_id = (select public.my_family()));
create policy shopping_insert on public.shopping_items for insert to authenticated
  with check (family_id = (select public.my_family()) and added_by = (select auth.uid()));
create policy shopping_update on public.shopping_items for update to authenticated
  using (family_id = (select public.my_family())) with check (family_id = (select public.my_family()));
create policy shopping_delete on public.shopping_items for delete to authenticated
  using (family_id = (select public.my_family()));

-- Live-Abgleich zwischen den Geräten (Supabase Realtime, beachtet die Zugriffsregeln)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Benachrichtigung: neue Artikel werden zu einer Meldung gebündelt
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'event_new', 'event_changed', 'event_cancelled', 'event_deleted', 'reminder', 'test',
  'task_new', 'task_assigned', 'task_done', 'task_reminder', 'comment_new', 'meal_new', 'shopping'));

-- Einkaufsliste ist standardmäßig AUS (wird sonst zu viel), alles andere standardmäßig AN
create or replace function public.push_wanted(p_user uuid, p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when p_type = 'shopping'
      then (m.settings -> 'notify' ->> 'shopping') = 'true'
      else (m.settings -> 'notify' ->> case
              when p_type in ('event_changed', 'event_cancelled', 'event_deleted') then 'event_changed'
              when p_type in ('task_new', 'task_assigned', 'task_done') then 'task'
              when p_type = 'task_reminder' then 'reminder'
              when p_type = 'comment_new' then 'comment'
              when p_type = 'meal_new' then 'meal'
              else p_type end) is distinct from 'false'
      end
    from public.members m where m.user_id = p_user), p_type <> 'shopping')
$$;

create function public.shopping_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_existing bigint;
  v_label text := trim(concat_ws(' ', new.quantity, new.unit, new.name));
begin
  for r in select m.user_id from public.members m
           where m.family_id = new.family_id and m.user_id is distinct from new.added_by loop
    select id into v_existing from public.notifications
     where user_id = r.user_id and type = 'shopping' and read_at is null
       and title = 'Einkaufsliste · neu von ' || public.actor_name()
       and created_at > now() - interval '30 minutes'
     order by id desc limit 1;
    if v_existing is not null then
      update public.notifications
         set body = left(body || ', ' || v_label, 300)
       where id = v_existing;
    else
      insert into public.notifications (user_id, type, title, body, url, push_state)
      values (r.user_id, 'shopping', 'Einkaufsliste · neu von ' || public.actor_name(), v_label,
              '#/einkauf', case when public.push_wanted(r.user_id, 'shopping') then 'pending' else 'skipped' end);
    end if;
  end loop;
  return null;
end;
$$;
create trigger shopping_notify after insert on public.shopping_items
  for each row execute function public.shopping_notify();

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
  public.meal_in_my_family(uuid), public.set_meal_cooked(uuid, boolean), public.meal_storage_ok(text, boolean)
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open()
  to anon, authenticated;
