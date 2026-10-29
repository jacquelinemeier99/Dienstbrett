// Erzeugt iCalendar-Dateien (Outlook, Google, Apple) – gemeinsam genutzt von App und Kalender-Abo
import { info, is24 } from './codes.js';

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:MESZ', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:MEZ', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const d8 = (day) => day.replaceAll('-', '');                       // 2026-10-29 -> 20261029
const t6 = (time) => time.slice(0, 5).replace(':', '') + '00';     // 08:00(:00) -> 080000
const nextDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + 1));
  return x.toISOString().slice(0, 10);
};
// Zeilen über 75 Zeichen umbrechen (RFC 5545)
const fold = (line) => {
  const out = []; let rest = line;
  while (new TextEncoder().encode(rest).length > 74) {
    let cut = 74; while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut)); rest = ' ' + rest.slice(cut);
  }
  out.push(rest); return out.join('\r\n');
};

/** items: { uid, day:'YYYY-MM-DD', title, from?:'HH:MM', to?:'HH:MM', toNextDay?:bool, busy?:bool } */
export function buildCalendar(name, items, stamp = new Date()) {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dienstbrett//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...VTIMEZONE];
  for (const it of items) {
    L.push('BEGIN:VEVENT', `UID:${it.uid}`, `DTSTAMP:${dtstamp}`);
    if (it.from) {
      L.push(`DTSTART;TZID=Europe/Berlin:${d8(it.day)}T${t6(it.from)}`,
             `DTEND;TZID=Europe/Berlin:${d8(it.toNextDay ? nextDay(it.day) : it.day)}T${t6(it.to)}`);
    } else {
      L.push(`DTSTART;VALUE=DATE:${d8(it.day)}`, `DTEND;VALUE=DATE:${d8(nextDay(it.day))}`);
    }
    L.push(`TRANSP:${it.busy ? 'OPAQUE' : 'TRANSPARENT'}`, `SUMMARY:${esc(it.title)}`, 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/** Dienst als Kalendereintrag: 24-h-Dienste 08:00–08:00, alles andere ganztägig */
export function shiftItem(userKey, day, code) {
  const g = info(code).grp;
  const title = g === 'h24' ? `${code} – 24-h-Dienst` : g === 'wache' ? `${code} – 24-h-Dienst (andere Wache)`
    : code === 'Frei' ? 'Frei' : `${code} – ${info(code).label.replace(/ \(.*\)$/, '')}`;
  const base = { uid: `dienst-${day}-${userKey}@dienstbrett`, day, title };
  return is24(code) ? { ...base, from: '08:00', to: '08:00', toNextDay: true, busy: true } : base;
}
export function eventItem(e) {
  return { uid: `team-${e.id}@dienstbrett`, day: e.day, title: e.title,
    ...(e.at ? { from: e.at, to: addHour(e.at), busy: true } : {}) };
}
export function apptItem(a) {
  return { uid: `termin-${a.id}@dienstbrett`, day: a.day, title: a.title || 'Privat', from: a.t_from, to: a.t_to, busy: true };
}
function addHour(t) { const [h, m] = t.split(':').map(Number); return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
