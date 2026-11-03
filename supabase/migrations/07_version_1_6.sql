-- =====================================================================
-- Familienzeit – Datenbank Version 1.6: Offline-Funktion und Geräte
-- Wird automatisch von der GitHub Action "Datenbank aktualisieren" eingespielt.
-- =====================================================================

-- Offline angelegte Einkaufsartikel bringen ihre eigene ID mit,
-- damit spätere Änderungen (abhaken, löschen) eindeutig zugeordnet werden.
grant insert (id) on public.shopping_items to authenticated;

-- Angemeldete Geräte (Sitzungen) des eigenen Kontos
create function public.my_sessions()
returns table (id uuid, created_at timestamptz, last_active timestamptz, user_agent text, current boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    select s.id, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at), s.user_agent::text,
           s.id::text = (auth.jwt() ->> 'session_id')
    from auth.sessions s
    where s.user_id = auth.uid()
    order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc;
end;
$$;

-- Ein anderes Gerät abmelden (das aktuelle Gerät meldet sich normal ab)
create function public.revoke_session(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_id::text = (auth.jwt() ->> 'session_id') then
    raise exception 'Dieses Gerät bitte über „Abmelden“ abmelden';
  end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
end;
$$;

revoke execute on function public.my_sessions(), public.revoke_session(uuid) from public, anon;
grant execute on function public.my_sessions(), public.revoke_session(uuid) to authenticated;
