-- =====================================================================
-- Familienzeit – automatische Sicherheitstests
-- Läuft in GitHub ("Sicherheitstests") gegen eine frische Test-Datenbank,
-- NIE gegen die echte Datenbank. Jeder fehlgeschlagene Test bricht ab.
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
\o /dev/null

create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FEHLGESCHLAGEN: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

-- Erwartet, dass die Anweisung abgelehnt wird (Fehler) – ohne Nebenwirkungen
create function t.fails(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok  % (abgelehnt: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FEHLGESCHLAGEN: % – wurde NICHT abgelehnt', msg;
end $$;

-- Anzahl Zeilen einer Abfrage
create function t.n(q text) returns bigint language plpgsql as $$
declare r bigint;
begin execute format('select count(*) from (%s) x', q) into r; return r; end $$;

create function t.als(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  perform set_config('request.jwt.claims', '{}', false);
  if uid is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

grant execute on all functions in schema t to authenticated, anon;

create table t.ids (k text primary key, v text);
grant select, insert, update on t.ids to authenticated, anon;
create function t.id(k text) returns uuid language sql as $$ select v::uuid from t.ids where ids.k = id.k $$;
create function t.v(k text) returns text language sql as $$ select v from t.ids where ids.k = v.k $$;
create function t.merke(k text, v text) returns void language sql as $$
  insert into t.ids values (k, v) on conflict (k) do update set v = excluded.v
$$;
grant execute on all functions in schema t to authenticated, anon;

\echo '== Grundregeln der Datenbank'
select t.ok((select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
            'Zugriffsregeln (RLS) sind auf allen Tabellen eingeschaltet');
select t.ok((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosecdef
               and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
            'Alle Funktionen mit erhöhten Rechten haben einen festen Suchpfad');
select t.ok((select count(*) = 0 from information_schema.role_table_grants
             where grantee = 'anon' and table_schema = 'public'),
            'Nicht angemeldete Besucher haben auf keine Tabelle Zugriff');

\echo '== Familie gründen und einladen'
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test', '{"display_name":"Admin","family_name":"Testfamilie"}');
select t.fails($$insert into auth.users (email, raw_user_meta_data) values ('fremd@test', '{"display_name":"Fremd"}')$$,
  'Zweite Registrierung ohne Einladung');
select t.merke('A', '00000000-0000-0000-0000-00000000000a');

select t.als(t.id('A'));
select t.merke('tok_parent', (select token from public.create_invitation('parent')));
select t.merke('tok_child1', (select token from public.create_invitation('child')));
select t.merke('tok_child2', (select token from public.create_invitation('child')));
select t.fails($$select public.create_invitation('child')$$, 'Drittes Kind einladen');
select t.fails($$select public.create_invitation('parent')$$, 'Zweites Elternteil einladen');
select t.fails($$select public.create_invitation('admin')$$, 'Zweiten Administrator einladen');
reset role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000b', 'eltern@test', jsonb_build_object('display_name', 'Eltern', 'invite_token', t.v('tok_parent'))),
  ('00000000-0000-0000-0000-00000000000c', 'kind1@test', jsonb_build_object('display_name', 'Kind1', 'invite_token', t.v('tok_child1'))),
  ('00000000-0000-0000-0000-00000000000d', 'kind2@test', jsonb_build_object('display_name', 'Kind2', 'invite_token', t.v('tok_child2')));
select t.merke('P', '00000000-0000-0000-0000-00000000000b');
select t.merke('C', '00000000-0000-0000-0000-00000000000c');
select t.merke('D', '00000000-0000-0000-0000-00000000000d');
select t.fails(format($$insert into auth.users (email, raw_user_meta_data) values ('x@test', '{"display_name":"X","invite_token":"%s"}')$$, t.v('tok_child1')),
  'Einladung ein zweites Mal benutzen');
select t.ok((select count(*) = 4 from public.members), 'Genau vier Mitglieder');
select t.fails($$delete from auth.users where email = 'kind1@test'$$, 'Mitglied über die Benutzerverwaltung löschen');

\echo '== Nicht angemeldet'
select t.als(null);
select t.fails($$select * from public.members$$, 'Gast liest Mitglieder');
select t.fails($$select * from public.events$$, 'Gast liest Termine');
select t.fails($$select public.create_invitation('child')$$, 'Gast erstellt Einladung');
select t.ok(public.setup_open() = false, 'Gast sieht nur, dass die Familie schon existiert');
reset role;

\echo '== Profile und Familie'
select t.als(t.id('C'));
select t.ok(t.n('select * from public.members') = 4, 'Kind sieht die Familie');
select t.ok(t.n('select * from public.invitations') = 0, 'Kind sieht keine Einladungen');
select t.fails($$select public.create_invitation('child')$$, 'Kind erstellt Einladung');
update public.members set display_name = 'Gehackt' where user_id = t.id('A');
select t.ok((select display_name from public.members where user_id = t.id('A')) = 'Admin', 'Kind ändert fremdes Profil nicht');
select t.fails($$update public.members set role = 'admin' where user_id = auth.uid()$$, 'Kind macht sich zum Administrator');
select t.fails($$delete from public.members where user_id = t.id('D')$$, 'Kind entfernt Mitglied');
update public.families set name = 'X';
select t.ok((select name from public.families) = 'Testfamilie', 'Kind benennt Familie nicht um');
select t.fails($$update public.families set admin_id = auth.uid()$$, 'Kind übernimmt Administratorrolle');
reset role;
select t.als(t.id('A'));
select t.fails($$update public.families set admin_id = t.id('P')$$, 'Administrator überträgt seine Rolle');
select t.fails($$delete from public.families$$, 'Administrator löscht die Familie');
reset role;

\echo '== Termine und Sichtbarkeit'
select t.als(t.id('C'));
select t.merke('ev_priv', public.save_event(null, null,
  '{"title":"Geheim","starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T11:00:00Z","visibility":"private"}', '{}', '{30}')::text);
insert into public.comments (family_id, event_id, author_id, body) values (public.my_family(), t.id('ev_priv'), auth.uid(), 'privat');
insert into storage.objects (bucket_id, name, metadata) values ('familie', public.my_family() || '/events/' || t.v('ev_priv') || '/a.webp', '{"size":1000}');
insert into public.attachments (family_id, event_id, storage_path, file_name, mime, size_bytes, uploaded_by)
  values (public.my_family(), t.id('ev_priv'), public.my_family() || '/events/' || t.v('ev_priv') || '/a.webp', 'a.webp', 'image/webp', 1000, auth.uid());
insert into public.event_exceptions (event_id, original_start, cancelled) values (t.id('ev_priv'), '2026-12-01T10:00:00Z', false);
select t.fails($$select public.save_event(null, null, '{"title":"X","starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T11:00:00Z","visibility":"parents"}', '{}', null)$$,
  'Kind legt „Nur Eltern“-Termin an');
reset role;

select t.als(t.id('A'));
select t.merke('ev_par', public.save_event(null, null,
  '{"title":"Elternsache","starts_at":"2026-12-02T10:00:00Z","ends_at":"2026-12-02T11:00:00Z","visibility":"parents"}', array[t.id('P')], null)::text);
select t.merke('ev_own', public.save_event(null, null,
  '{"title":"Zahnarzt","starts_at":"2026-12-03T10:00:00Z","ends_at":"2026-12-03T11:00:00Z","visibility":"family"}', array[t.id('A')], null)::text);
select t.merke('ev_fam', public.save_event(null, null,
  '{"title":"Familie","starts_at":"2026-12-04T10:00:00Z","ends_at":"2026-12-04T11:00:00Z","visibility":"family"}', '{}', null)::text);
select t.fails(format($$select public.save_event(%L, 1, '{"title":"Elternsache","starts_at":"2026-12-02T10:00:00Z","ends_at":"2026-12-02T11:00:00Z","visibility":"parents"}', array[%L, %L]::uuid[], null)$$,
  t.v('ev_par'), t.v('P'), t.v('C')), 'Kind einem „Nur Eltern“-Termin zuordnen');
-- Der Administrator darf vom privaten Kindertermin nichts sehen
select t.ok(t.n(format('select * from public.events where id = %L', t.v('ev_priv'))) = 0, 'Admin: privater Kindertermin unsichtbar');
select t.ok(t.n($$select * from public.events_in_range('2026-11-01', '2027-01-01') where title = 'Geheim'$$) = 0, 'Admin: auch nicht über die Zeitraum-Abfrage');
select t.ok(t.n(format('select * from public.event_history where event_id = %L', t.v('ev_priv'))) = 0, 'Admin: Verlauf des privaten Termins unsichtbar');
select t.ok(t.n(format('select * from public.event_reminders where event_id = %L', t.v('ev_priv'))) = 0, 'Admin: Erinnerungen unsichtbar');
select t.ok(t.n(format('select * from public.event_exceptions where event_id = %L', t.v('ev_priv'))) = 0, 'Admin: Ausnahmen unsichtbar');
select t.ok(t.n(format('select * from public.comments where event_id = %L', t.v('ev_priv'))) = 0, 'Admin: Kommentare unsichtbar');
select t.ok(t.n(format('select * from public.attachments where event_id = %L', t.v('ev_priv'))) = 0, 'Admin: Anhänge unsichtbar');
select t.ok(t.n($$select * from storage.objects where name like '%/events/%'$$) = 0, 'Admin: Dateien des privaten Termins unsichtbar');
select t.ok(t.n($$select * from public.notifications where title like '%Geheim%'$$) = 0, 'Admin: keine Meldung zum privaten Termin');
select t.fails(format($$select public.save_event(%L, 1, '{"title":"x","starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T11:00:00Z","visibility":"private"}', '{}', null)$$, t.v('ev_priv')),
  'Admin ändert privaten Kindertermin');
select t.fails(format($$insert into public.comments (family_id, event_id, author_id, body) values (public.my_family(), %L, auth.uid(), 'x')$$, t.v('ev_priv')),
  'Admin kommentiert privaten Kindertermin');
select t.fails(format($$insert into storage.objects (bucket_id, name) values ('familie', public.my_family() || '/events/' || %L || '/x.webp')$$, t.v('ev_priv')),
  'Admin lädt Datei an privaten Kindertermin');
delete from public.events where id = t.id('ev_priv');
reset role;
select t.ok((select count(*) = 1 from public.events where id = t.id('ev_priv')), 'Admin löscht privaten Kindertermin nicht');

select t.als(t.id('P'));
select t.ok(t.n(format('select * from public.events where id = %L', t.v('ev_priv'))) = 0, 'Elternteil: privater Kindertermin unsichtbar');
select t.ok(t.n(format('select * from public.events where id = %L', t.v('ev_par'))) = 1, 'Elternteil sieht „Nur Eltern“-Termin');
select t.ok(public.can_edit_event(t.id('ev_own')) = false, 'Elternteil bearbeitet fremden zugeordneten Termin nicht');
reset role;

select t.als(t.id('D'));
select t.ok(t.n(format('select * from public.events where id = %L', t.v('ev_par'))) = 0, 'Kind sieht „Nur Eltern“-Termin nicht');
select t.ok(t.n(format('select * from public.events where id = %L', t.v('ev_priv'))) = 0, 'Geschwisterkind sieht privaten Termin nicht');
select t.ok(public.can_edit_event(t.id('ev_fam')), 'Familientermin ohne Zuordnung darf jeder bearbeiten');
select t.fails(format($$select public.save_event(%L, 1, '{"title":"Familie","starts_at":"2026-12-04T10:00:00Z","ends_at":"2026-12-04T11:00:00Z","visibility":"private"}', '{}', null)$$, t.v('ev_fam')),
  'Nur der Ersteller ändert die Sichtbarkeit');
select public.save_event(t.id('ev_fam'), 1, '{"title":"Familie neu","starts_at":"2026-12-04T10:00:00Z","ends_at":"2026-12-04T11:00:00Z","visibility":"family"}', '{}', null);
select t.fails(format($$select public.save_event(%L, 1, '{"title":"veraltet","starts_at":"2026-12-04T10:00:00Z","ends_at":"2026-12-04T11:00:00Z","visibility":"family"}', '{}', null)$$, t.v('ev_fam')),
  'Gleichzeitige Änderung mit veraltetem Stand');
reset role;

\echo '== Benachrichtigungen und Push'
select t.ok((select count(*) = 0 from public.notifications n join public.events e on e.id = n.event_id
             where e.title = 'Familie neu' and n.user_id = t.id('D') and n.type = 'event_changed'), 'Keine Meldung an den, der selbst geändert hat');
select t.als(t.id('C'));
select t.ok(t.n($$select * from public.notifications where user_id <> auth.uid()$$) = 0, 'Jeder sieht nur seine eigenen Meldungen');
select t.fails($$update public.notifications set title = 'x'$$, 'Meldungstext ändern');
select t.fails($$select * from public.push_config$$, 'Versandschlüssel lesen');
select t.fails($$select public.add_reminder(gen_random_uuid(), auth.uid(), now(), 5, 'x', 'y', 'z')$$, 'Erinnerung direkt erzeugen');
select public.register_push('https://push.test/1', 'p', 'a', 'Handy');
reset role;
select t.als(t.id('A'));
select t.ok(t.n('select * from public.push_subscriptions') = 0, 'Fremde Push-Geräte unsichtbar');
select public.register_push('https://push.test/1', 'p2', 'a2', 'Tablet');
reset role;
select t.ok((select user_id from public.push_subscriptions where endpoint = 'https://push.test/1') = t.id('A'), 'Gemeinsames Gerät: Abo wechselt zum neuen Konto');

\echo '== Aufgaben, Kommentare'
select t.als(t.id('A'));
select t.merke('task_c', public.save_task(null, null, '{"title":"Zimmer"}', array[t.id('C')], null)::text);
reset role;
select t.als(t.id('P'));
select t.ok(public.can_edit_task(t.id('task_c')) = false, 'Elternteil bearbeitet Aufgabe eines anderen nicht');
update public.tasks set status = 'done' where id = t.id('task_c');
select t.fails(format($$insert into public.comments (family_id, task_id, author_id, body) values (public.my_family(), %L, %L, 'x')$$, t.v('task_c'), t.v('A')),
  'Kommentar unter fremdem Namen');
reset role;
select t.ok((select status from public.tasks where id = t.id('task_c')) = 'open', 'Fremde Aufgabe bleibt unverändert');

\echo '== Essenswünsche und Einkaufsliste'
select t.als(t.id('C'));
insert into public.meal_wishes (family_id, owner_id, title) values (public.my_family(), auth.uid(), 'Pizza');
insert into public.meal_favorites (meal_id, user_id) select id, auth.uid() from public.meal_wishes;
select t.fails($$insert into public.shopping_items (family_id, name, added_by) values (public.my_family(), 'x', t.id('A'))$$, 'Einkaufsartikel unter fremdem Namen');
reset role;
select t.als(t.id('A'));
update public.meal_wishes set title = 'Gehackt';
select t.ok(t.n('select * from public.meal_favorites') = 0, 'Favoriten anderer sind unsichtbar');
reset role;
select t.ok((select title from public.meal_wishes) = 'Pizza', 'Fremden Essenswunsch nicht änderbar');

\echo '== Externe Kalender und Importe'
select t.als(t.id('C'));
select t.merke('feed', public.add_feed('Schule', 'other', 'https://example.org/s.ics', 'private', true, '#C9567A')::text);
select t.fails($$select * from public.calendar_feed_urls$$, 'Kalender-Link lesen (eigener)');
select t.fails($$select public.add_feed('x', 'other', 'javascript:alert(1)', 'private', true, '#000000')$$, 'Ungültiger Kalender-Link');
reset role;
insert into public.events (family_id, owner_id, title, starts_at, ends_at, visibility, source, feed_id, external_uid)
  select family_id, user_id, 'Abo-Termin', now(), now(), visibility, 'feed', id, 'x1' from public.calendar_feeds;
select t.als(t.id('A'));
select t.ok(t.n('select * from public.calendar_feeds') = 0, 'Fremde Abos unsichtbar');
select t.fails(format($$select public.delete_feed(%L)$$, t.v('feed')), 'Fremdes Abo beenden');
select t.fails($$select public.import_events('[]', null, 'family', 'x', 'red')$$, 'Ungültige Farbe beim Import');
reset role;
select t.als(t.id('C'));
select t.ok((select public.can_edit_event(id) from public.events where external_uid = 'x1') = false, 'Abo-Termine sind nicht bearbeitbar');
select t.fails($$select public.import_events('[]', null, 'parents', 'x', '#123456')$$, 'Kind importiert als „Nur Eltern“');
reset role;

\echo '== Dateien und Speicher'
select t.als(t.id('C'));
select t.fails($$insert into storage.objects (bucket_id, name) values ('familie', public.my_family() || '/avatars/' || t.v('A') || '.webp')$$,
  'Profilbild eines anderen hochladen');
select t.fails($$insert into storage.objects (bucket_id, name) values ('familie', public.my_family() || '/events/../x.webp')$$, 'Ungültiger Dateipfad');
reset role;
update public.fz_limits set storage_bytes = 1000;
select t.als(t.id('C'));
select t.fails($$insert into storage.objects (bucket_id, name, metadata) values ('familie', public.my_family() || '/avatars/' || auth.uid() || '.webp', '{"size":10}')$$,
  'Hochladen bei vollem Speicher');
select t.ok((select uploads_blocked from public.usage_stats()), 'Verbrauchsanzeige meldet vollen Speicher');
reset role;
update public.fz_limits set storage_bytes = 1073741824;

\echo '== Geräte'
insert into auth.sessions (id, user_id, user_agent) values
  ('11111111-1111-1111-1111-111111111111', t.id('A'), 'A-Handy'),
  ('22222222-2222-2222-2222-222222222222', t.id('C'), 'C-Handy');
select t.als(t.id('A'));
select t.ok(t.n('select * from public.my_sessions()') = 1, 'Nur eigene Geräte sichtbar');
select public.revoke_session('22222222-2222-2222-2222-222222222222');
reset role;
select t.ok((select count(*) = 2 from auth.sessions), 'Fremdes Gerät lässt sich nicht abmelden');

\echo ''
\echo '✓ Alle Sicherheitstests bestanden.'
