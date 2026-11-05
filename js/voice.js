// Sprachbefehle: sprechen (Android) bzw. diktieren (iPhone), Vorschau prüfen, speichern.
import { h, icon, avatar, toast, sheet, busy } from './dom.js';
import * as api from './api.js';
import { state, go, render, urlFor } from './app.js';
import { parseCommand } from './voice-parse.js';
import { toDateInput, fromDateInput, fromInputs, addDays, fmtDayLong, relativeDay } from './dates.js';
import { buildRule, dayCode, ruleText } from './recur.js';
import { defaultReminders } from './settings.js';
import { addToShopping } from './views/shopping.js';
import { vibrate } from './gestures.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const MODE_KEY = 'fz-voice-mode';

// Auf dem iPhone ist die Spracherkennung in einer installierten Web-App unzuverlässig → Diktat der Tastatur
function canListen() {
  if (!SR || (IOS && STANDALONE)) return false;
  try { return localStorage.getItem(MODE_KEY) !== 'text'; } catch { return true; }
}
function rememberMode(mode) { try { localStorage.setItem(MODE_KEY, mode); } catch { /* egal */ } }

const EXAMPLES = [
  'Termin am Freitag um 15 Uhr Zahnarzt für Mia',
  'Aufgabe Müll rausbringen bis morgen',
  'Milch, Eier und Brot auf die Einkaufsliste',
  'Jeden Dienstag um 17 Uhr Schwimmen',
];

export function voiceButton() {
  return h('button', { class: 'voice-fab', type: 'button', 'aria-label': 'Sprachbefehl', onClick: () => { vibrate(8); openVoice(); } }, icon('mic', 24));
}

export function openVoice(startText = '') {
  let rec = null;
  const stop = () => { try { rec?.abort(); } catch { /* egal */ } rec = null; };

  sheet('Sprachbefehl', (close) => {
    const body = h('div', { class: 'voice' });

    // ---------- Schritt 1: Eingabe ----------
    const inputStage = (text = '', listen = canListen()) => {
      stop();
      const area = h('textarea', {
        class: 'input voice-text', rows: 3, maxlength: 500, enterkeyhint: 'done',
        placeholder: listen ? 'Hier erscheint, was du sagst …' : 'z. B. Termin am Freitag um 15 Uhr Zahnarzt',
        'aria-label': 'Sprachbefehl',
      });
      area.value = text;
      const status = h('p', { class: 'voice-status', role: 'status' });
      const next = h('button', { class: 'btn accent block', type: 'button', onClick: () => preview(area.value) }, 'Weiter');
      area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); preview(area.value); } });

      const mic = h('button', { class: 'voice-mic', type: 'button', 'aria-label': 'Sprechen' }, icon('mic', 34));
      const listenNow = () => {
        stop();
        rec = new SR();
        rec.lang = 'de-DE';
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        let finalText = '';
        let failed = false;
        rec.onstart = () => { mic.classList.add('on'); status.textContent = 'Ich höre zu …'; };
        rec.onresult = (e) => {
          let interim = '';
          finalText = '';
          for (const res of e.results) { if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript; }
          area.value = (finalText + interim).trim();
        };
        rec.onerror = (e) => {
          failed = true;
          mic.classList.remove('on');
          if (e.error === 'no-speech') status.textContent = 'Nichts gehört. Tippe auf das Mikrofon und sprich noch einmal.';
          else if (e.error === 'aborted') status.textContent = '';
          else if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
            rememberMode('text');
            inputStage(area.value, false);
            toast(e.error === 'audio-capture' ? 'Kein Mikrofon gefunden. Du kannst den Befehl auch tippen oder diktieren.' : 'Mikrofon nicht erlaubt. Du kannst den Befehl tippen oder mit dem Mikrofon der Tastatur diktieren.', { duration: 6000 });
          } else status.textContent = 'Das hat nicht geklappt. Bitte noch einmal versuchen.';
        };
        rec.onend = () => {
          mic.classList.remove('on');
          rec = null;
          if (!failed && area.value.trim()) preview(area.value);
          else if (!failed) status.textContent = 'Tippe auf das Mikrofon und sprich.';
        };
        try { rec.start(); } catch { status.textContent = 'Spracherkennung konnte nicht starten.'; }
      };
      mic.addEventListener('click', () => { if (rec) { try { rec.stop(); } catch { /* egal */ } } else listenNow(); });

      const switchLink = listen
        ? h('button', { class: 'link-btn', type: 'button', onClick: () => { rememberMode('text'); inputStage(area.value, false); } }, 'Lieber tippen oder diktieren')
        : (SR && !(IOS && STANDALONE)
          ? h('button', { class: 'link-btn', type: 'button', onClick: () => { rememberMode('voice'); inputStage(area.value, true); } }, 'Direkt sprechen')
          : null);

      body.replaceChildren(
        listen ? h('div', { class: 'voice-mic-wrap' }, mic) : h('div', { class: 'notice' }, icon('mic', 20),
          h('span', null, IOS ? 'Tippe auf der Tastatur auf das Mikrofon 🎤 und sprich deinen Befehl. Dann „Weiter“.' : 'Tippe deinen Befehl oder nutze das Mikrofon der Tastatur.')),
        status, area, next,
        h('div', { class: 'voice-examples' },
          h('p', { class: 'muted small' }, 'Zum Beispiel:'),
          EXAMPLES.map((x) => h('button', { type: 'button', class: 'voice-ex', onClick: () => preview(x) }, '„' + x + '“'))),
        switchLink ? h('div', { style: { textAlign: 'center', marginTop: '6px' } }, switchLink) : null);

      if (listen) listenNow();
      else setTimeout(() => area.focus(), 60);
    };

    // ---------- Schritt 2: Vorschau ----------
    const preview = (text) => {
      stop();
      text = (text || '').trim();
      if (!text) { toast('Bitte zuerst etwas sagen oder eingeben.'); return; }
      const p = parseCommand(text, { members: state.members, meId: state.me.user_id });
      const draft = {
        type: p.type,
        title: p.title,
        date: p.date ? toDateInput(p.date) : '',
        time: p.time || '',
        endTime: p.endTime || '',
        duration: p.duration || 60,
        allDay: p.allDay,
        people: new Set(p.people),
        rrule: p.rrule,
        priority: p.priority,
        items: p.items,
        notes: p.notes,
      };
      // Bei Wechsel auf Einkauf aus dem Titel Artikel machen
      const itemsFromTitle = () => (draft.title ? draft.title.split(/\s*(?:,|\bund\b)\s*/i).filter(Boolean) : []);
      drawPreview(text, draft, itemsFromTitle);
    };

    const drawPreview = (text, d, itemsFromTitle) => {
      const err = h('div', { class: 'error', role: 'alert', hidden: true });
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Art' },
        [['event', 'Termin'], ['task', 'Aufgabe'], ['shopping', 'Einkauf']].map(([v, label]) => h('button', {
          type: 'button', 'aria-pressed': String(d.type === v),
          onClick: () => {
            if (d.type === v) return;
            if (v === 'shopping' && !d.items.length) d.items = itemsFromTitle();
            if (v !== 'shopping' && !d.title && d.items.length) d.title = d.items.join(', ');
            if (v === 'event' && !d.date) d.date = toDateInput(new Date());
            if (v === 'event' && !d.time) d.allDay = true;
            d.type = v; drawPreview(text, d, itemsFromTitle);
          },
        }, label)));

      const fields = h('div', { class: 'voice-fields' });
      const title = h('input', { class: 'input', value: d.title, maxlength: 120, placeholder: 'Titel', 'aria-label': 'Titel' });
      title.addEventListener('input', () => { d.title = title.value; });

      const people = () => h('div', { class: 'chips' }, state.members.map((m) => {
        const b = h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(d.people.has(m.user_id)) },
          avatar(m, 22, urlFor(m)), m.user_id === state.me.user_id ? 'Ich' : m.display_name);
        b.addEventListener('click', () => {
          if (d.people.has(m.user_id)) d.people.delete(m.user_id); else d.people.add(m.user_id);
          b.setAttribute('aria-pressed', String(d.people.has(m.user_id)));
        });
        return b;
      }));
      const row = (label, ...c) => h('div', { class: 'field' }, h('label', null, label), ...c);

      if (d.type === 'event') {
        const date = h('input', { class: 'input', type: 'date', value: d.date, 'aria-label': 'Datum' });
        const allDay = h('input', { type: 'checkbox', checked: d.allDay, 'aria-label': 'Ganztägig' });
        const from = h('input', { class: 'input', type: 'time', value: d.time || '09:00', 'aria-label': 'Beginn' });
        const to = h('input', { class: 'input', type: 'time', value: d.endTime || endOf(d.time || '09:00', d.duration), 'aria-label': 'Ende' });
        const times = h('div', { class: 'row2 voice-times', hidden: d.allDay }, from, to);
        date.addEventListener('change', () => { d.date = date.value; drawWhen(); });
        allDay.addEventListener('change', () => { d.allDay = allDay.checked; times.hidden = d.allDay; drawWhen(); });
        from.addEventListener('change', () => {
          const old = d.time || '09:00';
          d.time = from.value;
          // Ende mitverschieben
          const diff = minutes(to.value) - minutes(old);
          to.value = endOf(from.value, diff > 0 ? diff : d.duration);
          d.endTime = to.value; drawWhen();
        });
        to.addEventListener('change', () => { d.endTime = to.value; });
        const when = h('p', { class: 'voice-when' });
        const drawWhen = () => {
          when.textContent = d.date ? relativeDay(fromDateInput(d.date)) + (d.allDay ? ', ganztägig' : `, ${from.value} Uhr`) : '';
        };
        drawWhen();
        if (!d.allDay && !d.time) d.time = from.value;
        const repeat = d.rrule ? h('div', { class: 'chips' },
          h('button', { type: 'button', class: 'fchip', 'aria-pressed': 'true', title: 'Wiederholung entfernen',
            onClick: () => { d.rrule = null; drawPreview(text, d, itemsFromTitle); } },
          icon('repeat', 16), repeatLabel(d), icon('x', 14))) : null;
        fields.replaceChildren(
          row('Titel', title),
          h('div', { class: 'field' }, h('label', null, 'Wann'), when, date),
          h('div', { class: 'switch-row' }, h('span', null, 'Ganztägig'), h('label', { class: 'toggle' }, allDay, h('span'))),
          times,
          repeat ? row('Wiederholung', repeat) : null,
          row('Wer', people(), h('div', { class: 'hint' }, 'Niemand ausgewählt = für die ganze Familie.')));
      } else if (d.type === 'task') {
        const date = h('input', { class: 'input', type: 'date', value: d.date, 'aria-label': 'Fällig am' });
        const time = h('input', { class: 'input', type: 'time', value: d.time, 'aria-label': 'Uhrzeit (optional)' });
        date.addEventListener('change', () => { d.date = date.value; });
        time.addEventListener('change', () => { d.time = time.value; });
        const prio = h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(d.priority === 'high') }, icon('star', 16), 'Wichtig');
        prio.addEventListener('click', () => { d.priority = d.priority === 'high' ? 'normal' : 'high'; prio.setAttribute('aria-pressed', String(d.priority === 'high')); });
        fields.replaceChildren(
          row('Titel', title),
          h('div', { class: 'field' }, h('label', null, 'Fällig'), h('div', { class: 'row2' }, date, time),
            h('div', { class: 'hint' }, 'Beides leer lassen = ohne Fälligkeit. Uhrzeit ist optional.')),
          row('Wer', people(), h('div', { class: 'hint' }, 'Niemand ausgewählt = für die ganze Familie.')),
          h('div', { class: 'chips', style: { marginBottom: '14px' } }, prio));
      } else {
        const list = h('textarea', { class: 'input', rows: Math.max(3, Math.min(8, d.items.length + 1)), 'aria-label': 'Artikel, einer pro Zeile' });
        list.value = d.items.join('\n');
        list.addEventListener('input', () => { d.items = list.value.split('\n').map((x) => x.trim()).filter(Boolean); });
        fields.replaceChildren(row('Artikel (einer pro Zeile)', list,
          h('div', { class: 'hint' }, 'Mengen wie „2 Liter Milch“ werden erkannt, die Kategorie wird automatisch gewählt.')));
      }

      const save = h('button', { class: 'btn accent', type: 'button', style: { flex: 1.4 } }, 'Speichern');
      save.addEventListener('click', async () => {
        err.hidden = true;
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        busy(save, true, 'Speichern …');
        try {
          const done = await saveDraft(d, fail);
          if (!done) { busy(save, false); return; }
          close();
          vibrate(12);
          done();
        } catch (ex) { fail(api.germanError(ex)); busy(save, false); }
      });
      const more = d.type === 'shopping' ? null : h('button', {
        class: 'btn ghost', type: 'button', style: { flex: 1 },
        onClick: () => { close(); go(editLink(d)); },
      }, 'Mehr Optionen');

      body.replaceChildren(
        h('div', { class: 'voice-heard' },
          h('span', { class: 'muted small' }, 'Verstanden: „' + text + '“'),
          h('button', { class: 'link-btn small', type: 'button', onClick: () => inputStage(text, false) }, 'Ändern'),
          canListen() ? h('button', { class: 'link-btn small', type: 'button', onClick: () => inputStage('', true) }, icon('mic', 15), 'Neu') : null),
        seg,
        d.notes.length && d.type !== 'shopping' ? h('div', { class: 'notice' }, icon('info', 20), h('span', null, d.notes.join(' '))) : null,
        err,
        fields,
        h('div', { class: 'btn-row' }, more, save));
    };

    inputStage(startText, !startText && canListen());
    if (startText) preview(startText);
    return body;
  }, stop);
}

// ---------- Hilfen ----------
const minutes = (t) => { const [a, b] = (t || '0:0').split(':').map(Number); return a * 60 + b; };
function endOf(time, dur = 60) {
  const m = Math.min(minutes(time) + dur, 23 * 60 + 59);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function rruleOf(d) {
  if (!d.rrule) return null;
  const byday = d.rrule.freq === 'WEEKLY' ? (d.rrule.byday.length ? d.rrule.byday : [dayCode(fromDateInput(d.date))]) : [];
  return buildRule({ freq: d.rrule.freq, interval: d.rrule.interval, byday });
}

function repeatLabel(d) {
  try {
    const start = d.date ? fromDateInput(d.date) : new Date();
    return ruleText(rruleOf(d), null, start);
  } catch { return 'Wiederholt sich'; }
}

// Link zum vollständigen Formular, vorausgefüllt
function editLink(d) {
  const q = new URLSearchParams();
  if (d.title) q.set('titel', d.title);
  if (d.date) q.set('datum', d.date);
  if (d.people.size) q.set('wer', [...d.people].join(','));
  if (d.type === 'event') {
    if (d.allDay) q.set('ganztag', '1');
    else { q.set('zeit', d.time || '09:00'); q.set('ende', d.endTime || endOf(d.time || '09:00', d.duration)); }
    const r = rruleOf(d); if (r) q.set('wdh', r);
    return '/termin?' + q.toString();
  }
  if (d.time) q.set('zeit', d.time);
  if (d.priority === 'high') q.set('prio', 'high');
  return '/aufgabe-bearbeiten?' + q.toString();
}

// Speichert den Entwurf. Gibt eine Funktion für die Rückmeldung zurück oder null bei Eingabefehlern.
async function saveDraft(d, fail) {
  if (d.type === 'shopping') {
    if (!d.items.length) { fail('Bitte mindestens einen Artikel eingeben.'); return null; }
    const n = await addToShopping(d.items);
    return () => {
      toast(n === 1 ? '1 Artikel auf der Einkaufsliste.' : `${n} Artikel auf der Einkaufsliste.`, { action: 'Anzeigen', onAction: () => go('/einkauf') });
      render();
    };
  }
  const title = d.title.trim();
  if (!title) { fail('Bitte einen Titel eingeben.'); return null; }

  if (d.type === 'event') {
    if (!d.date) { fail('Bitte ein Datum wählen.'); return null; }
    let s; let e;
    if (d.allDay) { s = fromDateInput(d.date); e = addDays(s, 1); }
    else {
      const from = d.time || '09:00';
      const to = d.endTime || endOf(from, d.duration);
      s = fromInputs(d.date, from);
      e = fromInputs(d.date, to);
      if (e <= s) e = new Date(s.getTime() + 3600000);
    }
    await api.saveEvent({
      data: {
        title, description: '', location: '',
        starts_at: s.toISOString(), ends_at: e.toISOString(), all_day: d.allDay,
        visibility: 'family', rrule: rruleOf(d), until: null,
      },
      participants: [...d.people],
      reminders: [...defaultReminders('event')].sort((a, b) => a - b),
    });
    return () => {
      toast(`Termin angelegt: ${fmtDayLong(s)}.`, { action: 'Anzeigen', onAction: () => go(`/kalender?v=day&d=${toDateInput(s)}`) });
      render();
    };
  }

  // Aufgabe
  let dueAt = null;
  if (d.date) dueAt = fromInputs(d.date, d.time || null);
  else if (d.time) { fail('Bitte zur Uhrzeit auch ein Datum wählen.'); return null; }
  const id = await api.saveTask({
    data: {
      title, description: '', priority: d.priority || 'normal', status: 'open',
      due_at: dueAt ? dueAt.toISOString() : '', due_all_day: !(dueAt && d.time),
    },
    assignees: [...d.people],
    reminders: dueAt ? [...defaultReminders('task')].sort((a, b) => a - b) : [],
  });
  return () => {
    toast('Aufgabe angelegt.', { action: 'Anzeigen', onAction: () => go(typeof id === 'string' ? `/aufgabe?id=${id}` : '/aufgaben') });
    render();
  };
}
