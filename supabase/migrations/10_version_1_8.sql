-- =====================================================================
-- Familienzeit – Datenbank Version 1.8: Speicher-Grenzen und Verbrauchsanzeige
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

-- Grenzen des Gratis-Tarifs (bei Bedarf hier anpassen)
create table public.fz_limits (
  id             int primary key default 1 check (id = 1),
  db_bytes       bigint not null default 524288000,    -- 500 MB Datenbank
  storage_bytes  bigint not null default 1073741824,   -- 1 GB Dateispeicher
  egress_note    text not null default '5 GB Datenübertragung pro Monat'
);
insert into public.fz_limits default values;
alter table public.fz_limits enable row level security;
revoke all on public.fz_limits from anon, authenticated;

create function public.fz_storage_used() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o where o.bucket_id = 'familie'
$$;

-- Neue Dateien nur, solange weniger als 95 % des Speichers belegt sind
create function public.storage_quota_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fz_storage_used() < (select storage_bytes * 0.95 from public.fz_limits where id = 1)
$$;

-- Verbrauch für die App (Speicher und Datenbank der Familie)
create function public.usage_stats()
returns table (db_bytes bigint, db_limit bigint, storage_bytes bigint, storage_limit bigint, file_count bigint, uploads_blocked boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.my_family() is null then raise exception 'Nicht angemeldet'; end if;
  return query
    select pg_database_size(current_database())::bigint, l.db_bytes,
           public.fz_storage_used(), l.storage_bytes,
           (select count(*) from storage.objects o where o.bucket_id = 'familie')::bigint,
           not public.storage_quota_ok()
    from public.fz_limits l where l.id = 1;
end;
$$;

-- Hochlade-Regeln um die Speicher-Grenze ergänzen
drop policy familie_avatar_insert on storage.objects;
create policy familie_avatar_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'familie'
    and name = (select public.my_family())::text || '/avatars/' || (select auth.uid())::text || '.webp'
    and public.storage_quota_ok()
  );

drop policy familie_files_insert on storage.objects;
create policy familie_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'familie' and public.storage_can_upload(name) and public.storage_quota_ok());

drop policy familie_meals_insert on storage.objects;
create policy familie_meals_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'familie' and public.meal_storage_ok(name, true) and public.storage_quota_ok());

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
  public.request_feed_sync(uuid), public.delete_feed(uuid),
  public.storage_quota_ok(), public.usage_stats()
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open()
  to anon, authenticated;
