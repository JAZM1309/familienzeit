-- =====================================================================
-- Familienzeit – Datenbank Version 1.0
-- Anmeldung, Einladungen, Profile, Startseite
--
-- Ausführen: Supabase-Dashboard → SQL Editor → New query →
-- gesamten Inhalt einfügen → Run. Nur EINMAL ausführen.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

-- Die eine Familie dieses Projekts
create table public.families (
  id          uuid primary key default gen_random_uuid(),
  singleton   boolean not null default true unique check (singleton),
  name        text not null check (char_length(trim(name)) between 1 and 60),
  admin_id    uuid not null unique references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now()
);

-- Familienmitglieder (max. 4: 1 Admin, 1 Elternteil, 2 Kinder)
create table public.members (
  user_id      uuid primary key references auth.users(id) on delete restrict,
  family_id    uuid not null references public.families(id) on delete restrict,
  role         text not null check (role in ('admin', 'parent', 'child')),
  email        text not null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  color        text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  avatar       text check (avatar is null or char_length(avatar) <= 16),
  avatar_path  text check (avatar_path is null or char_length(avatar_path) <= 200),
  settings     jsonb not null default '{}'::jsonb check (pg_column_size(settings) < 8000),
  joined_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index members_one_admin  on public.members (family_id) where role = 'admin';
create unique index members_one_parent on public.members (family_id) where role = 'parent';

-- Einladungen: gespeichert wird nur der Hash des Einladungs-Codes
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete restrict,
  role        text not null check (role in ('parent', 'child')),
  token_hash  text not null unique,
  created_by  uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete restrict,
  revoked_at  timestamptz
);

-- ---------------------------------------------------------------------
-- Hilfsfunktionen für Zugriffsregeln
-- ---------------------------------------------------------------------

create function public.my_family() returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.members where user_id = auth.uid()
$$;

create function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.members where user_id = auth.uid()
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.families where admin_id = auth.uid())
$$;

-- Anzahl erlaubter Plätze je Rolle
create function public.role_limit(p_role text) returns int
language sql immutable set search_path = '' as $$
  select case p_role when 'admin' then 1 when 'parent' then 1 when 'child' then 2 else 0 end
$$;

-- Nächste freie Profilfarbe
create function public.next_free_color(p_family uuid) returns text
language sql stable security definer set search_path = '' as $$
  select c from unnest(array['#27A99A','#E9A34A','#5B7FDB','#C9567A','#8A63D2','#3F9C4F']) with ordinality as t(c, n)
  where p_family is null
     or c not in (select color from public.members where family_id = p_family)
  order by n limit 1
$$;

-- ---------------------------------------------------------------------
-- Registrierung: nur erster Account (gründet die Familie) oder mit Einladung
-- ---------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_token  text  := nullif(trim(meta ->> 'invite_token'), '');
  v_name   text  := nullif(trim(meta ->> 'display_name'), '');
  v_fam    uuid;
  v_inv    public.invitations%rowtype;
  v_count  int;
begin
  if v_name is null then
    raise exception 'Name fehlt';
  end if;

  -- Gleichzeitige Registrierungen nacheinander abarbeiten
  perform pg_advisory_xact_lock(hashtext('familienzeit_signup'));

  if v_token is null then
    -- Nur der allererste Account darf ohne Einladung entstehen und wird Admin
    if exists (select 1 from public.families) then
      raise exception 'Registrierung nur mit Einladung möglich';
    end if;

    insert into public.families (name, admin_id)
    values (coalesce(nullif(trim(meta ->> 'family_name'), ''), 'Unsere Familie'), new.id)
    returning id into v_fam;

    insert into public.members (user_id, family_id, role, email, display_name, color)
    values (new.id, v_fam, 'admin', new.email, v_name, public.next_free_color(v_fam));
  else
    select * into v_inv from public.invitations
    where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
    for update;

    if not found or v_inv.used_at is not null or v_inv.revoked_at is not null
       or v_inv.expires_at < now() then
      raise exception 'Einladung ungültig oder abgelaufen';
    end if;

    select count(*) into v_count from public.members
    where family_id = v_inv.family_id and role = v_inv.role;
    if v_count >= public.role_limit(v_inv.role) then
      raise exception 'Kein freier Platz für diese Rolle';
    end if;

    insert into public.members (user_id, family_id, role, email, display_name, color)
    values (new.id, v_inv.family_id, v_inv.role, new.email, v_name,
            public.next_free_color(v_inv.family_id));

    update public.invitations set used_at = now(), used_by = new.id where id = v_inv.id;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- E-Mail-Änderungen ins Profil übernehmen
create function public.sync_member_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.members set email = new.email where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_member_email();

-- updated_at pflegen
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Einladungen (nur über diese Funktionen)
-- ---------------------------------------------------------------------

-- Admin erstellt eine Einladung; der Code wird nur dieses eine Mal zurückgegeben
create function public.create_invitation(p_role text)
returns table (id uuid, token text, role text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_fam   uuid;
  v_used  int;
  v_token text;
  v_id    uuid;
  v_exp   timestamptz := now() + interval '72 hours';
begin
  select f.id into v_fam from public.families f where f.admin_id = auth.uid() for update;
  if v_fam is null then
    raise exception 'Nur der Administrator kann einladen';
  end if;
  if p_role not in ('parent', 'child') then
    raise exception 'Ungültige Rolle';
  end if;

  select (select count(*) from public.members m where m.family_id = v_fam and m.role = p_role)
       + (select count(*) from public.invitations i
          where i.family_id = v_fam and i.role = p_role
            and i.used_at is null and i.revoked_at is null and i.expires_at > now())
    into v_used;
  if v_used >= public.role_limit(p_role) then
    raise exception 'Für diese Rolle ist kein Platz mehr frei';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invitations (family_id, role, token_hash, created_by, expires_at)
  values (v_fam, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), v_exp)
  returning invitations.id into v_id;

  return query select v_id, v_token, p_role, v_exp;
end;
$$;

-- Admin zieht eine offene Einladung zurück
create function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Nur der Administrator kann Einladungen zurückziehen';
  end if;
  update public.invitations set revoked_at = now()
  where id = p_id and family_id = public.my_family() and used_at is null and revoked_at is null;
end;
$$;

-- Einladungslink prüfen (auch ohne Anmeldung); verrät nur Familienname und Rolle
create function public.check_invitation(p_token text)
returns table (valid boolean, family_name text, role text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_inv public.invitations%rowtype;
  v_free boolean;
begin
  select * into v_inv from public.invitations
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if not found or v_inv.used_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at < now() then
    return query select false, null::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*) < public.role_limit(v_inv.role) into v_free from public.members m
  where m.family_id = v_inv.family_id and m.role = v_inv.role;

  return query
    select v_free, f.name, v_inv.role, v_inv.expires_at
    from public.families f where f.id = v_inv.family_id;
end;
$$;

-- Ist die App noch frisch (noch keine Familie angelegt)?
create function public.setup_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.families)
$$;

-- ---------------------------------------------------------------------
-- Rechte und Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------------

alter table public.families    enable row level security;
alter table public.members     enable row level security;
alter table public.invitations enable row level security;

revoke all on public.families, public.members, public.invitations from anon, authenticated;

grant select on public.families, public.members, public.invitations to authenticated;
grant update (name) on public.families to authenticated;
grant update (display_name, color, avatar, avatar_path, settings) on public.members to authenticated;

-- Familie: alle Mitglieder sehen sie, nur der Admin ändert den Namen
create policy families_select on public.families for select to authenticated
  using (id = (select public.my_family()));
create policy families_update on public.families for update to authenticated
  using (admin_id = (select auth.uid()))
  with check (admin_id = (select auth.uid()));

-- Mitglieder: alle sehen die eigene Familie, jeder ändert nur sich selbst
create policy members_select on public.members for select to authenticated
  using (family_id = (select public.my_family()));
create policy members_update on public.members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Einladungen: nur der Admin sieht die Liste
create policy invitations_select on public.invitations for select to authenticated
  using (family_id = (select public.my_family()) and (select public.is_admin()));

-- Keine Policies für insert/delete → niemand kann Mitglieder anlegen,
-- entfernen oder die Familie löschen.

-- Funktionsrechte
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_family(), public.my_role(), public.is_admin(),
  public.create_invitation(text), public.revoke_invitation(uuid)
  to authenticated;
grant execute on function public.check_invitation(text), public.setup_open()
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- Dateispeicher: privater Bucket "familie"
-- Pfad der Profilbilder: <family_id>/avatars/<user_id>.webp
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('familie', 'familie', false, 5242880,
        array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy familie_avatars_read on storage.objects for select to authenticated
  using (
    bucket_id = 'familie'
    and (storage.foldername(name))[1] = (select public.my_family())::text
    and (storage.foldername(name))[2] = 'avatars'
  );

create policy familie_avatar_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'familie'
    and name = (select public.my_family())::text || '/avatars/' || (select auth.uid())::text || '.webp'
  );

create policy familie_avatar_update on storage.objects for update to authenticated
  using (
    bucket_id = 'familie'
    and name = (select public.my_family())::text || '/avatars/' || (select auth.uid())::text || '.webp'
  )
  with check (
    bucket_id = 'familie'
    and name = (select public.my_family())::text || '/avatars/' || (select auth.uid())::text || '.webp'
  );

create policy familie_avatar_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'familie'
    and name = (select public.my_family())::text || '/avatars/' || (select auth.uid())::text || '.webp'
  );

-- Fertig. Erwartete Meldung: "Success. No rows returned"
