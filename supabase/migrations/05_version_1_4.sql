-- =====================================================================
-- Familienzeit – Datenbank Version 1.4: Essenswünsche
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

create table public.meal_wishes (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete restrict,
  owner_id    uuid not null references auth.users(id) on delete restrict,
  title       text not null check (char_length(trim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  ingredients text check (ingredients is null or char_length(ingredients) <= 4000),
  recipe      text check (recipe is null or char_length(recipe) <= 10000),
  recipe_url  text check (recipe_url is null or (recipe_url ~* '^https?://' and char_length(recipe_url) <= 1000)),
  image_path  text check (image_path is null or char_length(image_path) <= 300),
  image_url   text check (image_url is null or (image_url ~* '^https://' and char_length(image_url) <= 1000)),
  cooked      boolean not null default false,
  cooked_at   timestamptz,
  cooked_by   uuid references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index meal_wishes_family on public.meal_wishes (family_id, created_at desc);

create table public.meal_likes (
  meal_id    uuid not null references public.meal_wishes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (meal_id, user_id)
);

-- Favoriten sind persönlich: jeder sieht nur seine eigenen
create table public.meal_favorites (
  meal_id    uuid not null references public.meal_wishes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (meal_id, user_id)
);

create function public.meal_in_my_family(p_meal uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meal_wishes w where w.id = p_meal and w.family_id = public.my_family())
$$;

create function public.meals_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger meals_touch before update on public.meal_wishes
  for each row execute function public.meals_touch();

-- "Schon gekocht" darf jeder in der Familie setzen (z. B. wer gekocht hat)
create function public.set_meal_cooked(p_meal uuid, p_cooked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.meal_in_my_family(p_meal) then raise exception 'Keine Berechtigung'; end if;
  update public.meal_wishes
     set cooked = p_cooked,
         cooked_at = case when p_cooked then now() end,
         cooked_by = case when p_cooked then auth.uid() end
   where id = p_meal;
end;
$$;

-- ---------------------------------------------------------------------
-- Benachrichtigung bei neuem Essenswunsch
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'event_new', 'event_changed', 'event_cancelled', 'event_deleted', 'reminder', 'test',
  'task_new', 'task_assigned', 'task_done', 'task_reminder', 'comment_new', 'meal_new'));
alter table public.notifications add column meal_id uuid references public.meal_wishes(id) on delete set null;

create or replace function public.push_wanted(p_user uuid, p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (m.settings -> 'notify' ->> case
              when p_type in ('event_changed', 'event_cancelled', 'event_deleted') then 'event_changed'
              when p_type in ('task_new', 'task_assigned', 'task_done') then 'task'
              when p_type = 'task_reminder' then 'reminder'
              when p_type = 'comment_new' then 'comment'
              when p_type = 'meal_new' then 'meal'
              else p_type end) is distinct from 'false'
    from public.members m where m.user_id = p_user), true)
$$;

create function public.meals_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, title, body, url, meal_id, push_state)
  select m.user_id, 'meal_new', 'Neuer Essenswunsch: ' || new.title, 'von ' || public.actor_name(),
         '#/gericht?id=' || new.id, new.id,
         case when public.push_wanted(m.user_id, 'meal_new') then 'pending' else 'skipped' end
  from public.members m
  where m.family_id = new.family_id and m.user_id is distinct from new.owner_id;
  return null;
end;
$$;
create trigger meals_notify after insert on public.meal_wishes
  for each row execute function public.meals_notify();

-- ---------------------------------------------------------------------
-- Zugriffsregeln: alle in der Familie sehen alles, ändern darf der Ersteller
-- ---------------------------------------------------------------------
alter table public.meal_wishes    enable row level security;
alter table public.meal_likes     enable row level security;
alter table public.meal_favorites enable row level security;
revoke all on public.meal_wishes, public.meal_likes, public.meal_favorites from anon, authenticated;

grant select, delete on public.meal_wishes to authenticated;
grant insert (family_id, owner_id, title, description, ingredients, recipe, recipe_url, image_path, image_url)
  on public.meal_wishes to authenticated;
grant update (title, description, ingredients, recipe, recipe_url, image_path, image_url)
  on public.meal_wishes to authenticated;
grant select, insert, delete on public.meal_likes, public.meal_favorites to authenticated;

create policy meals_select on public.meal_wishes for select to authenticated
  using (family_id = (select public.my_family()));
create policy meals_insert on public.meal_wishes for insert to authenticated
  with check (family_id = (select public.my_family()) and owner_id = (select auth.uid()));
create policy meals_update on public.meal_wishes for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy meals_delete on public.meal_wishes for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy meal_likes_select on public.meal_likes for select to authenticated
  using (public.meal_in_my_family(meal_id));
create policy meal_likes_insert on public.meal_likes for insert to authenticated
  with check (user_id = (select auth.uid()) and public.meal_in_my_family(meal_id));
create policy meal_likes_delete on public.meal_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy meal_fav_select on public.meal_favorites for select to authenticated
  using (user_id = (select auth.uid()));
create policy meal_fav_insert on public.meal_favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and public.meal_in_my_family(meal_id));
create policy meal_fav_delete on public.meal_favorites for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Dateispeicher: <family_id>/meals/<meal_id>/<datei>
-- Lesen: ganze Familie. Hochladen/Löschen: Ersteller des Essenswunschs.
-- ---------------------------------------------------------------------
create function public.meal_storage_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := string_to_array(p_name, '/');
begin
  if cardinality(parts) <> 4 or parts[1] is distinct from public.my_family()::text or parts[2] <> 'meals'
     or parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.meal_wishes w
    where w.id = parts[3]::uuid and w.family_id = public.my_family()
      and (not p_write or w.owner_id = auth.uid()));
end;
$$;

create policy familie_meals_read on storage.objects for select to authenticated
  using (bucket_id = 'familie' and public.meal_storage_ok(name, false));
create policy familie_meals_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'familie' and public.meal_storage_ok(name, true));
create policy familie_meals_delete on storage.objects for delete to authenticated
  using (bucket_id = 'familie' and public.meal_storage_ok(name, true));

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
