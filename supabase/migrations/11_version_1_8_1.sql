-- =====================================================================
-- Familienzeit – Datenbank Version 1.8.1: Passwort zurücksetzen per Link vom Administrator
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

create table public.password_resets (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete restrict,
  user_id     uuid not null references auth.users(id) on delete restrict,
  token_hash  text not null unique,
  created_by  uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  revoked_at  timestamptz
);
alter table public.password_resets enable row level security;
revoke all on public.password_resets from anon, authenticated;
grant select (id, user_id, created_at, expires_at, used_at, revoked_at) on public.password_resets to authenticated;
create policy resets_admin_select on public.password_resets for select to authenticated
  using (family_id = (select public.my_family()) and (select public.is_admin()));

-- Administrator erzeugt einen Link (24 Stunden gültig, einmalig). Der Code wird nur jetzt angezeigt.
create function public.create_password_reset(p_user uuid)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
  v_exp timestamptz := now() + interval '24 hours';
begin
  if not public.is_admin() then raise exception 'Nur der Administrator kann Passwort-Links erstellen'; end if;
  if p_user = auth.uid() then raise exception 'Das eigene Passwort bitte im Profil ändern'; end if;
  if not exists (select 1 from public.members m where m.user_id = p_user and m.family_id = public.my_family()) then
    raise exception 'Person gehört nicht zur Familie';
  end if;
  -- ältere offene Links dieser Person ungültig machen
  update public.password_resets r set revoked_at = now()
   where r.user_id = p_user and r.used_at is null and r.revoked_at is null;
  insert into public.password_resets (family_id, user_id, token_hash, created_by, expires_at)
  values (public.my_family(), p_user, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), v_exp)
  returning password_resets.id into v_id;
  return query select v_id, v_token, v_exp;
end;
$$;

create function public.revoke_password_reset(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Keine Berechtigung'; end if;
  update public.password_resets set revoked_at = now()
   where id = p_id and family_id = public.my_family() and used_at is null and revoked_at is null;
end;
$$;

-- Link prüfen (ohne Anmeldung); verrät nur den Vornamen
create function public.check_password_reset(p_token text)
returns table (valid boolean, display_name text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.password_resets%rowtype;
begin
  select * into r from public.password_resets
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found or r.used_at is not null or r.revoked_at is not null or r.expires_at < now() then
    return query select false, null::text, null::timestamptz;
    return;
  end if;
  return query select true, m.display_name, r.expires_at from public.members m where m.user_id = r.user_id;
end;
$$;

-- Nur für die Server-Funktion: Link einlösen bzw. bei Fehler wieder freigeben
create function public.consume_password_reset(p_token text, out reset_id uuid, out user_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  update public.password_resets r set used_at = now()
   where r.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and r.used_at is null and r.revoked_at is null and r.expires_at > now()
  returning r.id, r.user_id into reset_id, user_id;
end;
$$;

create function public.release_password_reset(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.password_resets set used_at = null where id = p_id
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
  public.request_feed_sync(uuid), public.delete_feed(uuid),
  public.storage_quota_ok(), public.usage_stats(),
  public.create_password_reset(uuid), public.revoke_password_reset(uuid)
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open(), public.check_password_reset(text)
  to anon, authenticated;
