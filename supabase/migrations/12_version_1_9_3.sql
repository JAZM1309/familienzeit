-- Version 1.9.3: Fotos und Anhänge aus einem ZIP-Export wiederherstellen (nur Administrator)
-- Erlaubt wird ausschließlich das Hochladen von Dateien, die die Datenbank erwartet,
-- die im Speicher aber fehlen (z. B. nach einer Wiederherstellung der Datenbank).

-- Dateien, die erwartet werden, aber fehlen. Anhänge nur, soweit der Admin sie sehen darf.
create function public.missing_files()
returns table (path text, kind text, label text, mime text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Nur für den Administrator';
  end if;
  return query
    with refs as (
      select a.storage_path as path, 'anhang'::text as kind, a.file_name as label, a.mime, a.created_at
        from public.attachments a
       where a.family_id = public.my_family() and public.can_see_target(a.event_id, a.task_id)
      union all
      select w.image_path, 'essen'::text, w.title, null::text, w.created_at
        from public.meal_wishes w
       where w.family_id = public.my_family() and w.image_path is not null
      union all
      select m.avatar_path, 'profil'::text, m.display_name, 'image/webp'::text, m.joined_at
        from public.members m
       where m.family_id = public.my_family() and m.avatar_path is not null)
    select r.path, r.kind, r.label, r.mime, r.created_at
      from refs r
     where r.path like public.my_family()::text || '/%'
       and not exists (select 1 from storage.objects o where o.bucket_id = 'familie' and o.name = r.path)
     order by r.kind, r.created_at, r.path;
end;
$$;

create function public.storage_restore_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.is_admin(), false)
     and exists (select 1 from public.missing_files() f where f.path = p_name)
$$;

create policy familie_restore_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'familie' and public.storage_restore_ok(name) and public.storage_quota_ok());

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
  public.storage_quota_ok(), public.usage_stats(),
  public.create_password_reset(uuid), public.revoke_password_reset(uuid),
  public.missing_files(), public.storage_restore_ok(text)
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open(), public.check_password_reset(text)
  to anon, authenticated;
