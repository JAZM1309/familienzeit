// Abgleich externer Kalender: was muss angelegt, geändert, gelöscht werden?

const ts = (v) => (v == null ? null : new Date(v).getTime());
const str = (v) => (v == null || v === '' ? null : String(v));

function normExceptions(list) {
  return JSON.stringify((list || []).map((x) => ({
    o: ts(x.original_start), c: !!x.cancelled, t: str(x.title), d: str(x.description), l: str(x.location),
    s: ts(x.starts_at), e: ts(x.ends_at), a: x.all_day == null ? null : !!x.all_day,
  })).sort((a, b) => a.o - b.o));
}

function sameMain(old, n, visibility) {
  return str(old.title) === str(n.title) && str(old.description) === str(n.description) && str(old.location) === str(n.location)
    && ts(old.starts_at) === ts(n.starts_at) && ts(old.ends_at) === ts(n.ends_at) && !!old.all_day === !!n.all_day
    && str(old.rrule) === str(n.rrule) && str(old.until) === str(n.until) && old.visibility === visibility;
}

/**
 * existing: Termine dieses Abos aus der Datenbank (mit exceptions)
 * incoming: Ergebnis von icsToEvents().events
 */
export function planSync(existing, incoming, visibility) {
  const byKey = new Map(existing.map((e) => [e.external_uid, e]));
  const seen = new Set();
  const inserts = [];
  const updates = [];
  for (const n of incoming) {
    if (seen.has(n.external_uid)) continue; // doppelte UID in der Datei
    seen.add(n.external_uid);
    const old = byKey.get(n.external_uid);
    if (!old) { inserts.push(n); continue; }
    const main = !sameMain(old, n, visibility);
    const exc = normExceptions(old.exceptions) !== normExceptions(n.exceptions);
    if (main || exc) updates.push({ id: old.id, item: n, main, exc });
  }
  const deletes = existing.filter((e) => !seen.has(e.external_uid)).map((e) => e.id);
  return { inserts, updates, deletes, total: seen.size };
}

export function feedErrorText(status) {
  if (status === 401 || status === 403 || status === 404 || status === 410) {
    return 'Der Link funktioniert nicht (mehr). Bitte im externen Kalender einen neuen privaten Link erzeugen und hier eintragen.';
  }
  if (status === 429) return 'Der Kalender-Anbieter bremst gerade. Es wird später erneut versucht.';
  return `Der Kalender-Anbieter hat mit Fehler ${status} geantwortet. Es wird später erneut versucht.`;
}
