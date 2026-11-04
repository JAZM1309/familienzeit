#!/usr/bin/env bash
# Spielt eine entschlüsselte Familienzeit-Sicherung in eine BESTEHENDE Datenbank ein.
# Die Struktur (Tabellen, Rechte, Regeln) bleibt, wie sie ist – nur die Daten werden ersetzt.
#
# Umgebung:
#   DB_URL    Ziel-Datenbank
#   DUMP_DIR  Ordner mit familienzeit.dump, konten.dump, dateiliste.dump
#   MODUS     probe | echt   (probe = Testdatenbank, ohne Konten-Prüfung)
#   KONTEN    ja | nein      (fehlende Konten aus der Sicherung ergänzen; nur bei echt)
#
# Alles läuft in EINER Transaktion: Bei jedem Fehler bleibt die Datenbank unverändert.
set -euo pipefail
: "${DB_URL:?DB_URL fehlt}" "${DUMP_DIR:?DUMP_DIR fehlt}"
MODUS=${MODUS:-probe}
KONTEN=${KONTEN:-nein}
SUMMARY=${GITHUB_STEP_SUMMARY:-/dev/null}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

q() { psql "$DB_URL" -X -q -tA -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "::error::$*"; echo "**Abgebrochen:** $*" >> "$SUMMARY"; exit 1; }

for f in familienzeit.dump konten.dump dateiliste.dump; do
  [ -s "$DUMP_DIR/$f" ] || fail "In der Sicherung fehlt $f."
done

# --- Daten aus der Sicherung als SQL ---------------------------------------
pg_restore --data-only --no-owner --no-privileges --schema=public -f "$work/daten_roh.sql" "$DUMP_DIR/familienzeit.dump" \
  || fail "Die Sicherung lässt sich nicht lesen."
# Einstellungen neuerer Werkzeuge entfernen, die ältere Server nicht kennen
grep -v -E '^SET (transaction_timeout|idle_in_transaction_session_timeout) ' "$work/daten_roh.sql" > "$work/daten.sql"

# Zeilen je Tabelle in der Sicherung zählen
awk '/^COPY public\./ { t=$2; sub(/^public\./, "", t); n=0; inside=1; next }
     inside && /^\\\.$/ { print t "\t" n; inside=0; next }
     inside { n++ }' "$work/daten.sql" | LC_ALL=C sort > "$work/in_sicherung.tsv"

zaehle() {  # Zeilen in COPY-Blöcken einer Dump-Datei (Konten, Dateiliste)
  pg_restore --data-only -f - "$1" | awk '/^COPY / { inside=1; next } inside && /^\\\.$/ { inside=0; next } inside { n++ } END { print n+0 }'
}
konten_n=$(zaehle "$DUMP_DIR/konten.dump") || fail "Die Konten in der Sicherung lassen sich nicht lesen."
dateien_n=$(zaehle "$DUMP_DIR/dateiliste.dump") || fail "Die Dateiliste in der Sicherung lässt sich nicht lesen."

# --- Passt die Sicherung zur Datenbank? -------------------------------------
q -c "select tablename from pg_tables where schemaname = 'public' order by 1" > "$work/ziel_tabellen.txt"
cut -f1 "$work/in_sicherung.tsv" | while read -r t; do
  grep -qx "$t" "$work/ziel_tabellen.txt" || { echo "$t"; }
done > "$work/fehlend.txt"
if [ -s "$work/fehlend.txt" ]; then
  fail "Die Sicherung enthält Tabellen, die es in der Datenbank nicht gibt: $(paste -sd, "$work/fehlend.txt"). Bitte zuerst „Datenbank aktualisieren“ laufen lassen."
fi
liste=$(q -c "select string_agg(format('public.%I', tablename), ', ' order by tablename) from pg_tables where schemaname = 'public'")

# --- Konten (nur ergänzen, nie überschreiben) ------------------------------
konten_sql=""
if [ "$MODUS" = "echt" ] && [ "$KONTEN" = "ja" ]; then
  pg_restore --data-only -f - "$DUMP_DIR/konten.dump" \
    | grep -v -E '^SET (transaction_timeout|idle_in_transaction_session_timeout) ' \
    | sed -e 's/^COPY auth\.users /COPY pg_temp.r_users /' -e 's/^COPY auth\.identities /COPY pg_temp.r_identities /' \
    > "$work/konten_daten.sql"
  cat > "$work/konten.sql" <<SQL
create temp table r_users (like auth.users including defaults) on commit drop;
create temp table r_identities (like auth.identities including defaults) on commit drop;
\\i $work/konten_daten.sql
do \$\$
declare cols text; n int;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'auth' and table_name = 'users' and is_generated = 'NEVER';
  execute format('insert into auth.users (%1\$s) select %1\$s from pg_temp.r_users on conflict (id) do nothing', cols);
  get diagnostics n = row_count;
  raise notice 'Konten ergänzt: %', n;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and is_generated = 'NEVER';
  execute format('insert into auth.identities (%1\$s) select %1\$s from pg_temp.r_identities on conflict do nothing', cols);
end \$\$;
SQL
  konten_sql="\\i $work/konten.sql"
fi

pruefen=$([ "$MODUS" = "echt" ] && echo 1 || echo 0)
cat > "$work/einspielen.sql" <<SQL
\\set ON_ERROR_STOP 1
-- Automatiken (Benachrichtigungen, Verlauf, Prüfungen) während des Einspielens aus
set session_replication_role = replica;
truncate table $liste;
\\i $work/daten.sql
$konten_sql
set session_replication_role = origin;
\\if $pruefen
do \$\$
declare n int;
begin
  select count(*) into n from public.members m where not exists (select 1 from auth.users u where u.id = m.user_id);
  if n > 0 then
    raise exception 'In der Sicherung gibt es % Familienmitglied(er), deren Konto nicht mehr existiert. Starte erneut und setze den Haken „Konten mit wiederherstellen“', n;
  end if;
end \$\$;
\\endif
SQL

echo "→ Daten werden eingespielt …"
if ! psql "$DB_URL" -X -q -o /dev/null --single-transaction -v ON_ERROR_STOP=1 -f "$work/einspielen.sql" 2>&1 \
  | sed -e 's/^psql:[^:]*:[0-9]*: //' -e 's/^NOTICE:  //' | tee "$work/ausgabe.txt"; then
  fail "$(grep -m1 -E '^ERROR' "$work/ausgabe.txt" | sed 's/^ERROR:  //') – die Datenbank wurde nicht verändert."
fi

# --- Bericht ---------------------------------------------------------------
q -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
      from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1" \
  | tr '|' '\t' | LC_ALL=C sort > "$work/nachher.tsv"

declare -A LABEL=(
  [families]='Familie' [members]='Familienmitglieder' [invitations]='Einladungen'
  [events]='Termine' [event_participants]='Termin-Teilnehmer' [event_exceptions]='Serien-Ausnahmen'
  [event_reminders]='Termin-Erinnerungen' [event_history]='Termin-Verlauf'
  [tasks]='Aufgaben' [task_assignees]='Aufgaben-Zuständige' [task_reminders]='Aufgaben-Erinnerungen' [task_history]='Aufgaben-Verlauf'
  [comments]='Kommentare' [attachments]='Anhänge' [meal_wishes]='Essenswünsche' [meal_likes]='Essen: Likes'
  [meal_favorites]='Essen: Favoriten' [shopping_items]='Einkaufsartikel' [notifications]='Benachrichtigungen'
  [push_subscriptions]='Geräte für Push' [calendar_feeds]='Kalender-Abos' [calendar_imports]='Kalender-Importe'
)
{
  if [ "$MODUS" = "echt" ]; then echo "## ✅ Wiederherstellung abgeschlossen"; else echo "## ✅ Probelauf erfolgreich"; echo; echo "Die Sicherung ist lesbar und lässt sich einspielen. Deine echte App wurde **nicht** verändert."; fi
  echo
  echo "| Bereich | in der Sicherung | eingespielt |"
  echo "|---|---:|---:|"
  for t in families members events tasks comments meal_wishes shopping_items attachments calendar_feeds calendar_imports notifications push_subscriptions event_history task_history; do
    s=$(awk -F'\t' -v t="$t" '$1==t {print $2}' "$work/in_sicherung.tsv"); s=${s:-0}
    n=$(awk -F'\t' -v t="$t" '$1==t {print $2}' "$work/nachher.tsv"); n=${n:-0}
    mark=$([ "$s" = "$n" ] && echo "" || echo " ⚠️")
    echo "| ${LABEL[$t]:-$t} | $s | $n$mark |"
  done
  echo
  echo "Außerdem in der Sicherung: **$konten_n** Einträge zu Konten, **$dateien_n** Einträge in der Dateiliste."
} | tee -a "$SUMMARY"

# Abweichungen über alle Tabellen
abw=$(LC_ALL=C join -t $'\t' -a1 -e 0 -o 0,1.2,2.2 "$work/in_sicherung.tsv" "$work/nachher.tsv" | awk -F'\t' '$2 != $3 {print $1 " (" $2 " → " $3 ")"}' | paste -sd, -)
[ -z "$abw" ] || fail "Zeilenzahlen weichen ab: $abw"

if [ "$MODUS" = "echt" ]; then
  fehlend=$(q -c "
    with p(path) as (
      select avatar_path from public.members where avatar_path is not null
      union all select storage_path from public.attachments
      union all select image_path from public.meal_wishes where image_path is not null)
    select count(*) from p where not exists (select 1 from storage.objects o where o.bucket_id = 'familie' and o.name = p.path)")
  ohne=$(q -c "select count(*) from auth.users u where not exists (select 1 from public.members m where m.user_id = u.id)")
  {
    echo
    [ "$fehlend" = "0" ] || echo "- ⚠️ **$fehlend** Fotos/Anhänge fehlen im Speicher (Dateien sind nicht Teil der wöchentlichen Sicherung). Sie werden in der App als fehlend angezeigt."
    [ "$ohne" = "0" ] || echo "- ⚠️ **$ohne** Konto/Konten gehören jetzt zu keiner Familie (z. B. nach der Sicherung neu angemeldet). Diese Personen bitte neu einladen."
    echo "- Bitte die App auf allen Geräten einmal schließen und neu öffnen."
    echo "- Rückgängig machen: diesen Ablauf erneut starten mit Sicherung **rückgängig**."
  } | tee -a "$SUMMARY"
fi
