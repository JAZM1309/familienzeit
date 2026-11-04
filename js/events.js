// Gemeinsame Bausteine für Termine (Kalender, Startseite)
import { h, icon, avatar, sheet, toast, confirmDialog, choiceDialog, fold } from './dom.js';
import * as api from './api.js';
import { state, urlFor, go } from './app.js';
import { fmtTime, fmtDayShort, fmtDayLong, fmtDateTime, sameDay, addDays } from './dates.js';
import { ruleText } from './recur.js';
import { commentsBlock, attachmentsBlock } from './comments.js';

export const FAMILY_COLOR = '#8496AE';
export const VISIBILITY = {
  family: { label: 'Familie', hint: 'Alle in der Familie sehen den Termin.' },
  parents: { label: 'Nur Eltern', hint: 'Nur du und das andere Elternteil sehen den Termin.' },
  private: { label: 'Persönlich', hint: 'Nur du siehst diesen Termin. Niemand sonst, auch nicht der Administrator.' },
};
const REMINDER_TEXT = { 5: '5 Min.', 15: '15 Min.', 30: '30 Min.', 60: '1 Std.', 1440: '1 Tag' };

export function memberById(id) { return state.members.find((m) => m.user_id === id); }
export function nameOf(id) {
  if (!id) return 'Externer Kalender';
  if (id === state.me.user_id) return 'Du';
  return memberById(id)?.display_name || 'Jemand';
}

// "von dir" statt "von Du"
function byName(id) { return id === state.me.user_id ? 'dir' : nameOf(id); }

export function participantIds(ev) { return (ev.event_participants || []).map((p) => p.user_id); }

export function colorsFor(ev) {
  if (ev.color) return [ev.color]; // Farbe des externen oder importierten Kalenders
  if (ev.visibility === 'private') return [memberById(ev.owner_id)?.color || FAMILY_COLOR];
  const ids = participantIds(ev);
  if (!ids.length) return [FAMILY_COLOR];
  return state.members.filter((m) => ids.includes(m.user_id)).map((m) => m.color);
}

// Spiegelt die Regel der Datenbank (die Datenbank entscheidet trotzdem selbst)
export function canEdit(ev) {
  if (ev.feed_id) return false; // aus externem Kalender: nur lesbar
  const me = state.me.user_id;
  const ids = participantIds(ev);
  return ev.owner_id === me || ids.includes(me) || ids.length === 0;
}

export function reminderText(min) {
  if (min === 0) return 'Bei Fälligkeit';
  if (REMINDER_TEXT[min]) return REMINDER_TEXT[min] + ' vorher';
  if (min % 1440 === 0) return `${min / 1440} Tage vorher`;
  if (min % 60 === 0) return `${min / 60} Std. vorher`;
  return `${min} Min. vorher`;
}

export function timeText(occ, { withDay = false } = {}) {
  const { start, end, allDay } = occ;
  if (allDay) {
    const last = addDays(end, -1);
    const base = withDay ? fmtDayLong(start) + ' · ganztägig' : 'Ganztägig';
    return sameDay(start, last) || last < start ? base : `${base} bis ${fmtDayShort(last)}`;
  }
  const day = withDay ? fmtDayLong(start) + ' · ' : '';
  if (sameDay(start, end)) return start.getTime() === end.getTime() ? day + fmtTime(start) : `${day}${fmtTime(start)} – ${fmtTime(end)}`;
  return `${day}${fmtTime(start)} bis ${fmtDayShort(end)}, ${fmtTime(end)}`;
}

function colorBar(colors, vertical = true) {
  return h('div', { class: vertical ? 'ev-bar' : 'ev-bar h' }, colors.map((c) => h('span', { style: { background: c } })));
}

function badges(ev) {
  return [
    ev.visibility === 'private' ? h('span', { class: 'ev-tag', title: 'Persönlich' }, icon('lock', 13)) : null,
    ev.visibility === 'parents' ? h('span', { class: 'ev-tag text' }, 'Eltern') : null,
    ev.rrule ? h('span', { class: 'ev-tag', title: 'Wiederholt sich' }, icon('repeat', 13)) : null,
    ev.feed_id ? h('span', { class: 'ev-tag', title: 'Aus externem Kalender' }, icon('link', 13)) : null,
  ];
}

// Eine Zeile in Tages- und Wochenlisten
export function agendaItem(occ, onChange, { showDay = false } = {}) {
  const ev = occ.event;
  const ids = participantIds(ev);
  const people = ev.visibility === 'private' ? [] : state.members.filter((m) => ids.includes(m.user_id));
  const when = occ.allDay ? 'ganztägig' : fmtTime(occ.start);
  return h('button', { class: 'ev-item', onClick: () => openEvent(occ, onChange) },
    h('div', { class: 'ev-time' }, showDay ? h('div', { class: 'small muted' }, fmtDayShort(occ.start)) : null, when),
    colorBar(colorsFor(ev)),
    h('div', { class: 'ev-main' },
      h('div', { class: 'ev-title' }, occ.title, badges(ev)),
      (occ.location || !occ.allDay) ? h('div', { class: 'ev-sub' },
        occ.allDay ? '' : timeText(occ), occ.location ? (occ.allDay ? '' : ' · ') + occ.location : '') : null),
    people.length ? h('div', { class: 'ev-people' }, people.slice(0, 3).map((m) => avatar(m, 24, urlFor(m)))) : null);
}

// ---------- Detailansicht ----------
export function openEvent(occ, onChange) {
  const ev = occ.event;
  const ids = participantIds(ev);
  const people = state.members.filter((m) => ids.includes(m.user_id));
  const mine = ev.event_reminders?.[0]?.offsets || [];
  const editable = canEdit(ev);

  sheet(occ.title, (close) => {
    const row = (ic, ...content) => h('div', { class: 'detail-row' }, h('span', { class: 'detail-ic' }, icon(ic, 18)), h('div', null, ...content));
    const who = ev.visibility === 'private'
      ? 'Nur für dich'
      : people.length
        ? h('div', { class: 'chips' }, people.map((m) => h('span', { class: 'chip' }, avatar(m, 22, urlFor(m)), m.display_name)))
        : 'Ganze Familie';

    const edit = async () => {
      let scope = 'all';
      if (ev.rrule) {
        close();
        scope = await choiceDialog({
          title: 'Termin bearbeiten', text: 'Dieser Termin gehört zu einer Serie.',
          choices: [{ label: 'Nur diesen Termin', value: 'one', primary: true }, { label: 'Ganze Serie', value: 'all' }],
        });
        if (!scope) return;
      }
      close();
      go(scope === 'one'
        ? `/termin?id=${ev.id}&occ=${occ.originalStart.getTime()}`
        : `/termin?id=${ev.id}`);
    };

    const remove = async () => {
      close();
      if (ev.rrule) {
        const scope = await choiceDialog({
          title: 'Termin löschen?', text: 'Dieser Termin gehört zu einer Serie.',
          choices: [{ label: 'Nur diesen Termin', value: 'one', danger: true }, { label: 'Ganze Serie löschen', value: 'all', danger: true }],
        });
        if (!scope) return;
        if (scope === 'all' && !(await confirmDialog({ title: 'Ganze Serie löschen?', text: 'Alle Termine dieser Serie werden gelöscht. Das lässt sich nicht rückgängig machen.', ok: 'Löschen', danger: true }))) return;
        try {
          if (scope === 'one') await api.saveException({ event_id: ev.id, original_start: occ.originalStart.toISOString(), cancelled: true });
          else await api.deleteEventWithFiles(ev.id);
          toast(scope === 'one' ? 'Termin abgesagt.' : 'Serie gelöscht.');
          onChange?.();
        } catch (e) { toast(api.germanError(e), { type: 'error' }); }
        return;
      }
      if (!(await confirmDialog({ title: 'Termin löschen?', text: `„${occ.title}“ wird gelöscht. Das lässt sich nicht rückgängig machen.`, ok: 'Löschen', danger: true }))) return;
      try { await api.deleteEventWithFiles(ev.id); toast('Termin gelöscht.'); onChange?.(); }
      catch (e) { toast(api.germanError(e), { type: 'error' }); }
    };

    const created = new Date(ev.created_at);
    const updated = new Date(ev.updated_at);
    const changed = ev.updated_by && Math.abs(updated - created) > 2000;

    return h('div', null,
      colorBar(colorsFor(ev), false),
      row('clock', h('div', null, timeText(occ, { withDay: true })),
        ev.rrule ? h('div', { class: 'muted small' }, ruleText(ev.rrule, ev.until, new Date(ev.starts_at)),
          occ.exception ? ' · dieser Termin wurde einzeln geändert' : '') : null),
      occ.location ? row('pin', h('a', {
        href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(occ.location),
        target: '_blank', rel: 'noopener noreferrer',
      }, occ.location)) : null,
      row('users', who),
      ev.feed_id ? row('link', 'Aus einem externen Kalender' + (ev.owner_id === state.me.user_id ? '' : ` von ${nameOf(ev.owner_id)}`),
        h('div', { class: 'muted small' }, 'Wird automatisch abgeglichen. Ändern bitte im Ursprungskalender.')) : null,
      ev.source === 'ics' ? row('download', 'Aus einer Kalenderdatei importiert') : null,
      row(ev.visibility === 'private' ? 'lock' : 'shield', VISIBILITY[ev.visibility].label,
        h('div', { class: 'muted small' }, VISIBILITY[ev.visibility].hint)),
      row('bell', mine.length ? mine.map(reminderText).join(', ') : 'Keine Erinnerung',
        h('div', { class: 'muted small' }, 'Deine persönliche Erinnerung')),
      occ.description ? row('text', h('div', { class: 'pre' }, occ.description)) : null,
      h('div', { class: 'meta' },
        `Erstellt von ${byName(ev.owner_id)} · ${fmtDateTime(created)}`,
        changed ? h('br') : null,
        changed ? `Zuletzt geändert von ${byName(ev.updated_by)} · ${fmtDateTime(updated)}` : null,
        h('button', { class: 'link-btn', onClick: () => showHistory(ev) }, 'Verlauf anzeigen')),
      editable
        ? h('div', { class: 'btn-row', style: { marginTop: '16px' } },
          h('button', { class: 'btn', style: { flex: 1 }, onClick: edit }, icon('edit', 18), 'Bearbeiten'),
          h('button', { class: 'btn danger', style: { flex: 1 }, onClick: remove }, icon('trash', 18), 'Löschen'))
        : h('p', { class: 'muted small' }, ev.feed_id ? 'Termine aus externen Kalendern lassen sich hier nicht bearbeiten.' : 'Bearbeiten können der Ersteller und die zugeordneten Personen.'),
      h('div', { style: { height: '14px' } }),
      fold({ group: 'termin-extra', key: 'anhaenge', title: 'Anhänge', icon: 'camera', body: () => attachmentsBlock({ eventId: ev.id }, editable) }),
      fold({ group: 'termin-extra', key: 'kommentare', title: 'Kommentare', icon: 'text', body: () => commentsBlock({ eventId: ev.id }) }));
  });
}

// ---------- Änderungsverlauf ----------
const FIELD = {
  title: 'Titel', description: 'Beschreibung', location: 'Ort', starts_at: 'Beginn', ends_at: 'Ende',
  all_day: 'Ganztägig', visibility: 'Sichtbarkeit', rrule: 'Wiederholung', until: 'Wiederholungsende',
};

function fmtValue(key, v) {
  if (v == null || v === '') return '–';
  if (key === 'starts_at' || key === 'ends_at') return fmtDateTime(new Date(v));
  if (key === 'all_day') return v ? 'ja' : 'nein';
  if (key === 'visibility') return VISIBILITY[v]?.label || v;
  if (key === 'rrule') return 'geändert';
  if (key === 'until') return new Date(v).toLocaleDateString('de-DE');
  return String(v);
}

async function showHistory(ev) {
  let rows = [];
  try { rows = await api.eventHistory(ev.id); } catch (e) { toast(api.germanError(e), { type: 'error' }); return; }
  sheet('Verlauf', () => h('div', { class: 'history' }, rows.map((r) => {
    const who = nameOf(r.actor_id);
    let what;
    if (r.action === 'created') what = 'hat den Termin erstellt';
    else if (r.action === 'participant_added') what = `hat ${nameOf(r.changes?.user_id)} zugeordnet`;
    else if (r.action === 'participant_removed') what = `hat ${nameOf(r.changes?.user_id)} entfernt`;
    else if (r.action === 'instance_cancelled') what = `hat den Termin am ${fmtDayShort(new Date(r.changes?.original_start))} abgesagt`;
    else if (r.action === 'instance_changed') what = `hat den Termin am ${fmtDayShort(new Date(r.changes?.original_start))} einzeln geändert`;
    else what = 'hat geändert';
    const details = r.action === 'updated' && r.changes
      ? Object.entries(r.changes).map(([k, v]) => h('li', null,
        FIELD[k] || k, Array.isArray(v) && k !== 'rrule' ? `: ${fmtValue(k, v[0])} → ${fmtValue(k, v[1])}` : ''))
      : [];
    const self = r.actor_id === state.me.user_id;
    return h('div', { class: 'history-row' },
      h('div', null, h('strong', null, who), ' ', self ? what.replace(/^hat /, 'hast ') : what),
      details.length ? h('ul', null, details) : null,
      h('div', { class: 'muted small' }, fmtDateTime(new Date(r.at))));
  })));
}
