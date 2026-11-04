#!/usr/bin/env bash
# Baut eine frische Test-Datenbank auf und führt die Sicherheitstests aus.
# Aufruf: DB_URL=postgresql://… supabase/tests/ausfuehren.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
run() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }
export PGOPTIONS='-c client_min_messages=warning'
run -f supabase/tests/00_supabase_nachbau.sql >/dev/null
for f in $(ls supabase/migrations/*.sql | sort); do
  echo "→ $(basename "$f")"
  # Erweiterungen gibt es im Nachbau nicht; ihre Funktionen sind dort nachgebildet
  grep -v -i -E '^create extension if not exists (pg_net|pg_cron)' "$f" | run >/dev/null
done
unset PGOPTIONS
echo "→ Sicherheitstests"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/sicherheit.sql 2>&1 | sed -e 's/^psql:[^:]*:[0-9]*: //' -e 's/^NOTICE:  //'
