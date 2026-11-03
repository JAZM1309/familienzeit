import { h, icon, avatar, toast, field, busy, confirmDialog } from '../dom.js';
import * as api from '../api.js';
import { state, urlFor, go } from '../app.js';
import {
  startOfDay, addDays, toDateInput, toTimeInput, fromDateInput, fromInputs, fmtDayLong, WEEKDAYS_SHORT,
} from '../dates.js';
import { parseRule, buildRule, DAY_CODES, dayCode } from '../recur.js';
import { VISIBILITY, reminderText, canEdit } from '../events.js';

const PRESETS = [5, 15, 30, 60, 1440];
const REPEAT_OPTIONS = [
  ['none', 'Keine'], ['DAILY', 'Täglich'], ['WEEKLY', 'Wöchentlich'], ['BIWEEKLY', 'Alle zwei Wochen'],
  ['MONTHLY', 'Monatlich'], ['YEARLY', 'Jährlich'], ['CUSTOM', 'Eigenes Muster …'],
];
const UNITS = [['DAILY', 'Tage'], ['WEEKLY', 'Wochen'], ['MONTHLY', 'Monate'], ['YEARLY', 'Jahre']];

function back(dateForCalendar) {
  go(`/kalender?v=month&d=${toDateInput(dateForCalendar)}`);
}

function select(options, value, props = {}) {
  const s = h('select', { class: 'input', ...props }, options.map(([v, label]) => h('option', { value: v }, label)));
  s.value = value;
  return s;
}

function toggleChip(label, on, onToggle, extra) {
  const b = h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(on) }, extra, label);
  b.addEventListener('click', () => {
    const now = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(now));
    onToggle(now);
  });
  return b;
}

export async function eventEditView({ params }) {
  const id = params.get('id');
  const occParam = params.get('occ');
  let ev = null;

  if (id) {
    try { ev = await api.loadEvent(id); } catch (e) { toast(api.germanError(e), { type: 'error' }); }
    if (!ev) {
      return h('div', { class: 'center-state' }, h('div', null,
        h('p', null, 'Dieser Termin existiert nicht mehr oder ist für dich nicht sichtbar.'),
        h('button', { class: 'btn', onClick: () => go('/kalender') }, 'Zum Kalender')));
    }
    if (!canEdit(ev)) {
      return h('div', { class: 'center-state' }, h('div', null,
        h('p', null, 'Diesen Termin können nur der Ersteller und die zugeordneten Personen bearbeiten.'),
        h('button', { class: 'btn', onClick: () => go('/kalender') }, 'Zum Kalender')));
    }
  }

  const single = !!(ev && ev.rrule && occParam);
  const isOwner = !ev || ev.owner_id === state.me.user_id;
  const isParent = ['admin', 'parent'].includes(state.me.role);

  // ---------- Ausgangswerte ----------
  let start; let end; let src = ev;
  const originalStart = single ? new Date(Number(occParam)) : null;
  const exception = single ? (ev.event_exceptions || []).find((x) => new Date(x.original_start).getTime() === originalStart.getTime()) : null;

  if (ev) {
    const dur = new Date(ev.ends_at) - new Date(ev.starts_at);
    start = single ? new Date(exception?.starts_at || originalStart) : new Date(ev.starts_at);
    end = single ? new Date(exception?.ends_at || originalStart.getTime() + dur) : new Date(ev.ends_at);
    if (single && exception) {
      src = { ...ev,
        title: exception.title ?? ev.title,
        location: exception.location ?? ev.location,
        description: exception.description ?? ev.description,
        all_day: exception.all_day ?? ev.all_day };
    }
  } else {
    const base = params.get('datum') ? fromDateInput(params.get('datum')) : startOfDay(new Date());
    start = new Date(base);
    const now = new Date();
    if (base.toDateString() === now.toDateString()) start.setHours(now.getHours() + 1, 0, 0, 0);
    else start.setHours(9, 0, 0, 0);
    end = new Date(start.getTime() + 3600000);
  }
  const allDayInit = !!src?.all_day;
  const endShown = allDayInit ? addDays(end, -1) : end; // ganztägig: Enddatum inklusive

  // ---------- Felder ----------
  const err = h('div', { class: 'error', role: 'alert', hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  const title = h('input', { class: 'input', value: src?.title || '', maxlength: 120, required: true, placeholder: 'z. B. Fußballtraining' });
  const allDay = h('input', { type: 'checkbox', checked: allDayInit, 'aria-label': 'Ganztägig' });
  const sDate = h('input', { class: 'input', type: 'date', value: toDateInput(start), required: true });
  const sTime = h('input', { class: 'input', type: 'time', value: toTimeInput(start) });
  const eDate = h('input', { class: 'input', type: 'date', value: toDateInput(endShown), required: true });
  const eTime = h('input', { class: 'input', type: 'time', value: toTimeInput(end) });
  const location = h('input', { class: 'input', value: src?.location || '', maxlength: 200, placeholder: 'Optional' });
  const description = h('textarea', { class: 'input', rows: 3, maxlength: 4000, placeholder: 'Optional' });
  description.value = src?.description || '';

  const timeRow = (d, t) => h('div', { class: 'row2' }, d, t);
  const syncAllDay = () => { sTime.hidden = allDay.checked; eTime.hidden = allDay.checked; };
  allDay.addEventListener('change', syncAllDay);
  syncAllDay();

  // Beginn verschieben → Ende mitverschieben
  let lastStart = fromInputs(sDate.value, allDay.checked ? null : sTime.value);
  const shiftEnd = () => {
    if (!sDate.value) return;
    const ns = fromInputs(sDate.value, allDay.checked ? null : sTime.value);
    const oe = fromInputs(eDate.value || sDate.value, allDay.checked ? null : eTime.value);
    const ne = new Date(oe.getTime() + (ns - lastStart));
    eDate.value = toDateInput(ne);
    if (!allDay.checked) eTime.value = toTimeInput(ne);
    lastStart = ns;
  };
  sDate.addEventListener('change', shiftEnd);
  sTime.addEventListener('change', shiftEnd);

  // Sichtbarkeit
  let visibility = ev?.visibility || 'family';
  const visHint = h('div', { class: 'hint' });
  const visOptions = [['family', 'Familie'], ...(isParent ? [['parents', 'Nur Eltern']] : []), ['private', 'Persönlich']];
  const visSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Sichtbarkeit' });
  const drawVis = () => {
    visSeg.replaceChildren(...visOptions.map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(v === visibility), disabled: !isOwner,
      onClick: () => { visibility = v; drawVis(); drawPeople(); },
    }, label)));
    visHint.textContent = VISIBILITY[visibility].hint + (isOwner ? '' : ' Nur der Ersteller kann das ändern.');
  };

  // Personen
  const chosen = new Set((ev?.event_participants || []).map((p) => p.user_id));
  const peopleWrap = h('div');
  const drawPeople = () => {
    if (visibility === 'private') {
      peopleWrap.replaceChildren(h('p', { class: 'muted small', style: { margin: 0 } }, 'Persönliche Termine gehören nur dir.'));
      return;
    }
    const allowed = state.members.filter((m) => visibility !== 'parents' || m.role !== 'child');
    for (const id2 of [...chosen]) if (!allowed.some((m) => m.user_id === id2)) chosen.delete(id2);
    peopleWrap.replaceChildren(
      h('div', { class: 'chips' }, allowed.map((m) => toggleChip(
        m.user_id === state.me.user_id ? 'Ich' : m.display_name, chosen.has(m.user_id),
        (on) => { if (on) chosen.add(m.user_id); else chosen.delete(m.user_id); },
        avatar(m, 22, urlFor(m))))),
      h('div', { class: 'hint' }, 'Niemand ausgewählt = Termin für die ganze Familie.'));
  };

  // Wiederholung
  const rule = parseRule(ev?.rrule);
  let repeat = 'none';
  if (rule) {
    if (rule.interval === 1) repeat = rule.freq;
    else if (rule.freq === 'WEEKLY' && rule.interval === 2) repeat = 'BIWEEKLY';
    else repeat = 'CUSTOM';
  }
  const repeatSel = select(REPEAT_OPTIONS, repeat, { 'aria-label': 'Wiederholung' });
  const interval = h('input', { class: 'input', type: 'number', min: 1, max: 365, value: String(rule?.interval || 1), 'aria-label': 'Intervall' });
  const unitSel = select(UNITS, rule?.freq || 'WEEKLY', { 'aria-label': 'Einheit' });
  const byday = new Set(rule?.byday?.length ? rule.byday : [dayCode(start)]);
  const weekdayWrap = h('div', { class: 'weekdays' }, DAY_CODES.map((c, i) => toggleChip(WEEKDAYS_SHORT[i], byday.has(c),
    (on) => { if (on) byday.add(c); else byday.delete(c); })));
  const customRow = h('div', { class: 'row2' }, h('div', { class: 'inline-label' }, 'Alle', interval), unitSel);
  let untilOn = !!ev?.until;
  const untilDate = h('input', { class: 'input', type: 'date', value: ev?.until || toDateInput(addDays(start, 90)), 'aria-label': 'Wiederholung endet am' });
  const untilSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ende der Wiederholung' });
  const repeatDetails = h('div');
  const drawRepeat = () => {
    const r = repeatSel.value;
    const freq = r === 'CUSTOM' ? unitSel.value : r === 'BIWEEKLY' ? 'WEEKLY' : r;
    untilSeg.replaceChildren(...[[false, 'Nie'], [true, 'Am Datum']].map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(v === untilOn), onClick: () => { untilOn = v; drawRepeat(); },
    }, label)));
    untilDate.hidden = !untilOn;
    repeatDetails.replaceChildren(...(r === 'none' ? [] : [
      r === 'CUSTOM' ? customRow : null,
      freq === 'WEEKLY' ? h('div', { class: 'field' }, h('label', null, 'An diesen Tagen'), weekdayWrap) : null,
      h('div', { class: 'field' }, h('label', null, 'Endet'), untilSeg, h('div', { style: { marginTop: '8px' } }, untilDate)),
    ].filter(Boolean)));
  };
  repeatSel.addEventListener('change', drawRepeat);
  unitSel.addEventListener('change', drawRepeat);

  // Erinnerungen (persönlich)
  const reminders = new Set(ev?.event_reminders?.[0]?.offsets || []);
  const remWrap = h('div');
  const drawRem = () => {
    const all = [...new Set([...PRESETS, ...reminders])].sort((a, b) => a - b);
    const customVal = h('input', { class: 'input', type: 'number', min: 1, max: 999, value: '2', 'aria-label': 'Anzahl' });
    const customUnit = select([['1', 'Minuten'], ['60', 'Stunden'], ['1440', 'Tage']], '60', { 'aria-label': 'Einheit' });
    const custom = h('div', { class: 'row3', hidden: true }, customVal, customUnit,
      h('button', {
        type: 'button', class: 'btn ghost small',
        onClick: () => {
          const m = Number(customVal.value) * Number(customUnit.value);
          if (!(m > 0 && m <= 40320)) { toast('Bitte höchstens 28 Tage vorher.', { type: 'error' }); return; }
          if (reminders.size >= 6) { toast('Höchstens 6 Erinnerungen.', { type: 'error' }); return; }
          reminders.add(m); drawRem();
        },
      }, 'Hinzufügen'));
    remWrap.replaceChildren(
      h('div', { class: 'chips' },
        toggleChip('Keine', reminders.size === 0, () => { reminders.clear(); drawRem(); }),
        all.map((m) => toggleChip(reminderText(m).replace(' vorher', ''), reminders.has(m), (on) => {
          if (on) { if (reminders.size >= 6) { toast('Höchstens 6 Erinnerungen.', { type: 'error' }); drawRem(); return; } reminders.add(m); }
          else reminders.delete(m);
          drawRem();
        })),
        h('button', { type: 'button', class: 'fchip', onClick: () => { custom.hidden = !custom.hidden; } }, 'Eigene …')),
      custom,
      h('div', { class: 'hint' }, 'Gilt nur für dich und kommt als Push-Nachricht, wenn Benachrichtigungen eingeschaltet sind.'));
  };

  drawVis(); drawPeople(); drawRepeat(); drawRem();

  // ---------- Speichern ----------
  const save = h('button', { class: 'btn teal block', type: 'submit' }, 'Speichern');
  const onSubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!title.value.trim()) return showErr('Bitte einen Titel eingeben.');
    if (!sDate.value || !eDate.value) return showErr('Bitte Beginn und Ende angeben.');
    const ad = allDay.checked;
    const s = fromInputs(sDate.value, ad ? null : sTime.value || '00:00');
    const en = ad ? addDays(fromDateInput(eDate.value), 1) : fromInputs(eDate.value, eTime.value || '00:00');
    if (en < s || (ad && en <= s)) return showErr('Das Ende liegt vor dem Beginn.');

    busy(save, true, 'Speichern …');
    try {
      if (single) {
        await api.saveException({
          event_id: ev.id, original_start: originalStart.toISOString(), cancelled: false,
          title: title.value.trim(), description: description.value.trim(), location: location.value.trim(),
          starts_at: s.toISOString(), ends_at: en.toISOString(), all_day: ad,
        });
        toast('Dieser Termin wurde geändert.');
        back(s);
        return;
      }

      const r = repeatSel.value;
      let rrule = null;
      if (r !== 'none') {
        const freq = r === 'CUSTOM' ? unitSel.value : r === 'BIWEEKLY' ? 'WEEKLY' : r;
        const n = r === 'CUSTOM' ? Math.max(1, Math.min(365, Number(interval.value) || 1)) : r === 'BIWEEKLY' ? 2 : 1;
        const days = freq === 'WEEKLY' ? [...byday] : [];
        if (freq === 'WEEKLY' && !days.length) { busy(save, false); return showErr('Bitte mindestens einen Wochentag wählen.'); }
        rrule = buildRule({ freq, interval: n, byday: days });
      }
      const until = rrule && untilOn ? untilDate.value : null;
      if (until && fromDateInput(until) < startOfDay(s)) { busy(save, false); return showErr('Die Wiederholung endet vor dem ersten Termin.'); }

      // Geänderte Serie: einzeln geänderte Termine passen nicht mehr
      const seriesShifted = ev && ev.rrule && (ev.event_exceptions || []).length &&
        (rrule !== ev.rrule || s.getTime() !== new Date(ev.starts_at).getTime());
      if (seriesShifted) {
        const ok = await confirmDialog({
          title: 'Serie ändern?',
          text: 'Einzeln geänderte oder abgesagte Termine dieser Serie werden dabei zurückgesetzt.',
          ok: 'Trotzdem speichern',
        });
        if (!ok) { busy(save, false); return; }
      }

      await api.saveEvent({
        id: ev?.id, version: ev?.version,
        data: {
          title: title.value.trim(), description: description.value.trim(), location: location.value.trim(),
          starts_at: s.toISOString(), ends_at: en.toISOString(), all_day: ad,
          visibility, rrule, until,
        },
        participants: visibility === 'private' ? [] : [...chosen],
        reminders: [...reminders].sort((a, b) => a - b),
      });
      if (seriesShifted) await api.clearExceptions(ev.id);
      toast(ev ? 'Termin gespeichert.' : 'Termin angelegt.');
      back(s);
    } catch (ex) {
      showErr(api.germanError(ex));
      busy(save, false);
    }
  };

  const heading = single ? 'Diesen Termin ändern' : ev ? 'Termin bearbeiten' : 'Neuer Termin';
  return h('div', null,
    h('div', { class: 'hello' },
      h('button', { class: 'iconbtn', 'aria-label': 'Abbrechen', onClick: () => back(start) }, icon('back')),
      h('div', { class: 'grow' }, h('h1', { style: { fontSize: '1.35rem' } }, heading),
        single ? h('p', null, fmtDayLong(originalStart)) : null)),
    h('form', { onSubmit, novalidate: true },
      err,
      h('section', { class: 'card' },
        field('Titel', title),
        h('div', { class: 'switch-row' }, h('span', null, 'Ganztägig'), h('label', { class: 'toggle' }, allDay, h('span'))),
        h('div', { class: 'field' }, h('label', null, 'Beginn'), timeRow(sDate, sTime)),
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Ende'), timeRow(eDate, eTime))),
      single ? h('div', { class: 'notice' }, icon('info', 20),
        h('span', null, 'Personen, Sichtbarkeit, Wiederholung und Erinnerungen gelten für die ganze Serie.')) : null,
      single ? null : h('section', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Wer'), peopleWrap),
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Sichtbarkeit'), visSeg, visHint)),
      single ? null : h('section', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Wiederholung'), repeatSel),
        repeatDetails),
      h('section', { class: 'card' },
        field('Ort', location),
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Beschreibung'), description)),
      single ? null : h('section', { class: 'card' },
        h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, 'Meine Erinnerung'), remWrap)),
      save));
}
