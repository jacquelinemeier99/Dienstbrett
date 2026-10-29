// Schriften lokal eingebunden (kein Abruf bei Google)
import '@fontsource/figtree/latin-400.css';
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-600.css';
import '@fontsource/figtree/latin-700.css';
import '@fontsource/bricolage-grotesque/latin-600.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import './style.css';
import { GROUPS, CODES, ALL_CODES, QUICK, H24, OFF, REGULAR, info, is24 } from '../supabase/functions/_shared/codes.js';
import { buildCalendar, shiftItem, eventItem, apptItem } from '../supabase/functions/_shared/ics.js';
import { holidayName } from './holidays.js';
import * as api from './api.js';
const { store, shiftOf } = api;

/* ---------- Einstellungen (über .env anpassbar) ---------- */
const ENV = import.meta.env;
const ORG = ENV.VITE_ORG_NAME || 'unser Team';
const PRIVACY_CONTACT = ENV.VITE_PRIVACY_CONTACT || '';
const MIN_STAFF = Number(ENV.VITE_MIN_STAFF || 3);               // ab wann ein Tag als dünn besetzt gilt
const CARS = (ENV.VITE_CARS || 'Auto 1||;Auto 2||').split(';').map(s => { const [name, model, plate] = s.split('|'); return { name, model, plate }; });

/* ---------- Datum ---------- */
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const nice = d => `${DOW[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`;
const isWE = d => d.getDay() === 0 || d.getDay() === 6;
const monthKey = d => key(d).slice(0, 7);
const isoWeek = d => { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(t.getFullYear(), 0, 4); return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7); };
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hm = t => (t || '').slice(0, 5);
let TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);

const col = c => `var(${GROUPS[info(c).grp].color})`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const first = name => String(name).split(' ')[0];

/* ---------- Personen ---------- */
const todayKey = () => key(TODAY);
const activeGuest = p => p.role === 'guest' && p.guest_until >= todayKey();
const staff = () => store.profiles.filter(p => p.role !== 'guest');
const people = () => {                                   // ich zuerst, dann Team, dann Praktikum
  const me = store.profiles.find(p => p.id === store.me.id);
  const others = store.profiles.filter(p => p.id !== store.me.id && (p.role !== 'guest' || activeGuest(p)));
  return [me, ...others.filter(p => p.role !== 'guest'), ...others.filter(p => p.role === 'guest')].filter(Boolean);
};
const isMe = p => p.id === store.me.id;
const isGuest = () => store.me.role === 'guest';
const isAdmin = () => store.me.role === 'admin';
const nameOf = id => first(store.profiles.find(p => p.id === id)?.name || 'Ehemalig');

/* ---------- Abfragen ---------- */
const eventsOn = k => [...store.events.values()].filter(e => e.day === k).sort((a, b) => (a.at || '').localeCompare(b.at || ''));
const bookingsOn = (k, car) => [...store.bookings.values()].filter(b => b.day === k && (car === undefined || b.car === car)).sort((a, b) => a.t_from.localeCompare(b.t_from));
const apptsOn = k => [...store.appts.values()].filter(a => a.day === k).sort((a, b) => a.t_from.localeCompare(b.t_from));

function dayStats(k) {
  const out = {}; Object.keys(GROUPS).forEach(g => out[g] = []);
  const prev = key(addDays(parse(k), -1));
  for (const p of people()) {
    if (p.role === 'guest' && (k < p.guest_from || k > p.guest_until)) continue;
    const c = shiftOf(p.id, k);
    if (!c) { out.frei.push({ p, c: '', note: isWE(parse(k)) || holidayName(k) ? 'Wochenende / Feiertag' : 'Nichts eingetragen' }); continue; }
    const g = p.role === 'guest' && info(c).grp === 'buero' ? 'gast' : info(c).grp;
    const note = info(shiftOf(p.id, prev)).grp === 'h24' ? 'bis 08:00 noch im 24-h-Dienst' : '';
    out[g].push({ p, c, note });
  }
  return out;
}
const ORDER = ['buero', 'h24', 'gast', 'ho', 'wache', 'bv', 'urlaub', 'frei', 'other'];
const inOfficeN = s => s.buero.length + s.h24.length;   // C1, C2 (andere Wache), BV und Praktikum zählen nicht

/* ---------- UI-Zustand ---------- */
let view = 'heute', selDay = todayKey(), month = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), carDay = todayKey();
let showRegular = false, teamMode = 'woche';
const $app = document.getElementById('app'), $tabs = document.getElementById('tabs'), $layer = document.getElementById('layer');

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
const errText = e => {
  const m = e?.message || String(e);
  if (e?.code === '23P01') return 'Das Auto ist in dieser Zeit schon reserviert.';
  if (/row-level security|permission/i.test(m)) return 'Dafür hast du keine Berechtigung.';
  if (/fetch|network/i.test(m)) return 'Keine Verbindung. Bitte prüfe dein Internet und versuche es noch einmal.';
  return 'Das hat nicht geklappt: ' + m;
};
const safely = fn => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast(errText(e)); } };

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); } catch { toast(text); }
}

/* ---------- Tabbar ---------- */
const ICONS = {
  heute: '<path d="M3 21V9l9-6 9 6v12h-6v-7H9v7z"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.6c2.6.2 4.3 2 5 4.9"/>',
  plan: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  autos: '<path d="M5 17h14M4 17v-5l2.2-5.2A2 2 0 0 1 8 5.5h8a2 2 0 0 1 1.8 1.3L20 12v5M4 12h16"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
  ich: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
};
const TABS = [['heute', 'Heute'], ['team', 'Team'], ['plan', 'Mein Plan'], ['autos', 'Autos'], ['ich', 'Ich']];
function renderTabs() {
  $tabs.parentElement.hidden = false;
  $tabs.innerHTML = TABS.map(([id, l]) =>
    `<button class="tab" data-tab="${id}" ${view === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>${l}</button>`).join('');
}
const avatar = () => `<div class="avatar" aria-hidden="true">${esc(store.me.ini)}</div>`;
const hero = (hello, title, extra = '') => `<header class="hero wrap"><div class="hero-top"><div><div class="hello">${hello}</div><h1>${title}</h1></div>${avatar()}</div>${extra}</header>`;

/* ---------- Heute ---------- */
function heute() {
  const d = parse(selDay), st = dayStats(selDay);
  const monday = addDays(d, -((d.getDay() + 6) % 7));
  const week = [...Array(7)].map((_, i) => addDays(monday, i));
  const myC = shiftOf(store.me.id, selDay);
  const segs = ORDER.filter(g => st[g].length);
  const total = Math.max(1, segs.reduce((s, g) => s + st[g].length, 0));
  const chip = c => `<button class="chip" data-set="${esc(c)}" style="--c:${col(c)}" aria-pressed="${myC === c}"><span class="dot"></span>${esc(c)}</button>`;
  const hol = holidayName(selDay);
  return hero(`Hallo ${esc(first(store.me.name))}`, `${d.getTime() === TODAY.getTime() ? 'Heute, ' : ''}${nice(d)}`, `
    <div class="week">${week.map(w => {
      const k = key(w), n = inOfficeN(dayStats(k));
      return `<button class="wd ${k === selDay ? 'sel' : ''} ${w.getTime() === TODAY.getTime() ? 'today' : ''}" data-day="${k}" aria-label="${nice(w)}, ${n} im Büro"><small>${DOW[w.getDay()]}</small><strong>${w.getDate()}</strong><i>${n} da</i></button>`;
    }).join('')}</div>`) + `
  <div class="wrap">
    <section>
      ${hol ? `<p class="eyebrow">${esc(hol)}</p>` : ''}
      <div class="count"><span class="num">${inOfficeN(st)}</span><span class="of">von ${staff().length} im Büro<br>${st.ho.length} im Homeoffice · ${st.wache.length} auf anderer Wache${st.gast.length ? ` · ${st.gast.length} Praktikum` : ''}</span></div>
      <div class="bar">${segs.map(g => `<span style="width:${st[g].length / total * 100}%;background:var(${GROUPS[g].color})"></span>`).join('')}</div>
      <div class="legend">${segs.map(g => `<span><i class="dot" style="background:var(${GROUPS[g].color})"></i>${GROUPS[g].label} ${st[g].length}</span>`).join('')}</div>
    </section>
    <section>
      <div class="card">
        <div class="mynow"><div><div class="eyebrow" style="margin:0">Mein Dienst</div><strong>${myC ? esc(info(myC).label) : 'Nichts eingetragen'}</strong></div>
          ${myC ? `<span class="code" style="--c:${col(myC)}">${esc(myC)}</span>` : ''}</div>
        <div class="chips">${QUICK.map(chip).join('')}</div>
        <div class="chips-label">24-h-Dienst · 08:00 bis 08:00 am Folgetag · C1 und C2 auf anderer Wache</div>
        <div class="chips">${H24.map(chip).join('')}</div>
        <div class="chips-label">Abwesend</div>
        <div class="chips">${OFF.map(chip).join('')}</div>
      </div>
    </section>
    <section>
      <p class="eyebrow">Teamtermine · für alle sichtbar</p>
      <div class="card">
        ${eventsOn(selDay).length ? eventsOn(selDay).map(e => `<div class="ev"><time>${hm(e.at) || 'ganzt.'}</time><span class="t">${esc(e.title)}</span><button class="btn small ghost" data-act="ics-ev" data-id="${e.id}">Outlook</button>${!isGuest() && (e.created_by === store.me.id || isAdmin()) ? `<button class="linkbtn" data-act="del-ev" data-id="${e.id}">Löschen</button>` : ''}</div>`).join('') : '<p class="note" style="margin:0 0 10px">An diesem Tag gibt es keine Teamtermine.</p>'}
        ${isGuest() ? '' : '<div class="stack" style="margin-top:8px"><button class="btn ghost block" data-act="add-ev">Teamtermin eintragen</button></div>'}
      </div>
    </section>
    <section>
      <p class="eyebrow">Wer ist wo</p>
      ${ORDER.filter(g => st[g].length).map(g => `
        <div class="group"><h3><i class="dot" style="background:var(${GROUPS[g].color})"></i>${GROUPS[g].label} <em>${st[g].length}</em></h3>
        <div class="people">${st[g].map(({ p, c, note }) => `
          <div class="person"><span class="pav" style="--c:var(${GROUPS[g].color})">${esc(p.ini)}</span>
            <div class="pname"><div>${esc(p.name)}${isMe(p) ? ' (ich)' : ''}${p.role === 'guest' ? ' · Praktikum' : ''}</div><small>${esc(c ? info(c).label : '')}${note ? (c ? ' · ' : '') + note : ''}${is24(c) ? ' · 08:00 bis 08:00' : ''}</small></div>
            ${c ? `<span class="code" style="--c:${col(c)}">${esc(c)}</span>` : ''}</div>`).join('')}
        </div></div>`).join('')}
      <p class="note">Private Termine sind hier nie zu sehen. Die anderen sehen nur, welchen Dienst du hast.</p>
    </section>
  </div>`;
}

/* ---------- Team ---------- */
function weeks(y, m) {
  const ps = people(), firstD = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  let mon = addDays(firstD, -((firstD.getDay() + 6) % 7));
  const out = [], shortM = d => MON[d.getMonth()].slice(0, 3);
  while (mon <= last) {
    const days = [...Array(7)].map((_, i) => addDays(mon, i));
    const work = days.filter(d => !isWE(d) && !holidayName(key(d)));
    const counts = days.map(d => inOfficeN(dayStats(key(d))));
    const avg = work.length ? work.reduce((s, d) => s + inOfficeN(dayStats(key(d))), 0) / work.length : 0;
    let u = 0, h = 0; days.forEach(d => ps.forEach(p => { const c = shiftOf(p.id, key(d)); if (c === 'U' && !isWE(d)) u++; if (is24(c)) h++; }));
    const low = work.filter(d => inOfficeN(dayStats(key(d))) < MIN_STAFF).length;
    const now = days.some(d => d.getTime() === TODAY.getTime()), sun = days[6];
    out.push(`<article class="wk ${now ? 'now' : ''}" ${now ? 'id="wknow"' : ''}>
      <div class="wk-head"><div><span class="kw">KW ${isoWeek(mon)}</span><span class="range">${mon.getDate()}. ${shortM(mon)} – ${sun.getDate()}. ${shortM(sun)}</span></div>
        <div class="wk-sum"><span class="pill">Ø ${avg.toFixed(1).replace('.', ',')} im Büro</span>${u ? `<span class="pill">${u} ${u === 1 ? 'Urlaubstag' : 'Urlaubstage'}</span>` : ''}${h ? `<span class="pill">${h}× 24 h</span>` : ''}${low ? `<span class="pill warn2">${low} ${low === 1 ? 'Tag' : 'Tage'} unter ${MIN_STAFF}</span>` : ''}</div></div>
      <div class="wrow hd" style="--n:${ps.length}"><span></span>${ps.map(p => `<span class="ini ${isMe(p) ? 'me' : ''} ${p.role === 'guest' ? 'guest' : ''}" title="${esc(p.name)}${p.role === 'guest' ? ' (Praktikum)' : ''}">${esc(p.ini)}</span>`).join('')}<span class="ini">Büro</span></div>
      ${days.map((d, i) => {
        const k = key(d), hol = holidayName(k), n = counts[i], off = isWE(d) || hol;
        return `<div class="wrow ${isWE(d) ? 'we' : ''} ${hol ? 'hol' : ''} ${d.getTime() === TODAY.getTime() ? 'td' : ''}" style="--n:${ps.length}">
          <button class="dl" data-jump="${k}" aria-label="${nice(d)} öffnen" ${hol ? `title="${esc(hol)}"` : ''}><span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b>${hol ? '<em>Feiertag</em>' : ''}</button>
          ${ps.map(p => {
            const c = shiftOf(p.id, k), vis = c && (showRegular || !REGULAR.includes(c)), me = isMe(p);
            return vis ? `<span class="wc ${me ? 'me' : ''}" style="--c:${col(c)}" title="${esc(p.name)}: ${esc(info(c).label)}" ${me ? `data-editcell="${k}"` : ''}>${esc(c)}</span>`
                       : `<span class="wc empty ${me ? 'me' : ''}" ${me ? `data-editcell="${k}"` : ''}></span>`;
          }).join('')}
          <span class="cnt"><b style="color:${off ? 'var(--muted)' : n < MIN_STAFF ? 'var(--danger)' : 'var(--ink)'}">${n}</b><span class="track"><i style="width:${Math.min(100, n / Math.max(1, staff().length) * 100)}%;background:${off ? 'var(--g-frei)' : n < MIN_STAFF ? 'var(--danger)' : 'var(--g-buero)'}"></i></span></span>
        </div>${eventsOn(k).map(e => `<div class="evline"><span>${hm(e.at) || 'ganzt.'}</span><b>${esc(e.title)}</b></div>`).join('')}`;
      }).join('')}
    </article>`);
    mon = addDays(mon, 7);
  }
  return out.join('');
}
function monthTable(y, m) {
  const ps = people(), days = new Date(y, m + 1, 0).getDate();
  const ds = [...Array(days)].map((_, i) => new Date(y, m, i + 1));
  const cls = d => `${isWE(d) || holidayName(key(d)) ? 'we' : ''} ${d.getTime() === TODAY.getTime() ? 'td' : ''}`;
  return `<div class="mx-wrap" id="mxwrap"><table class="mx">
    <thead>
      <tr><th class="nm"></th>${ds.map(d => `<th class="${cls(d)}" ${d.getTime() === TODAY.getTime() ? 'id="mxtoday"' : ''}><button data-jump="${key(d)}" aria-label="${nice(d)} öffnen"><span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b>${eventsOn(key(d)).length ? `<i title="${esc(eventsOn(key(d)).map(e => e.title).join(', '))}"></i>` : ''}</button></th>`).join('')}</tr>
      <tr class="sum"><th class="nm">Im Büro</th>${ds.map(d => { const n = inOfficeN(dayStats(key(d))); return `<td class="${cls(d)}" style="color:${n < MIN_STAFF && !isWE(d) ? 'var(--danger)' : 'var(--g-buero)'}">${n}</td>`; }).join('')}</tr>
    </thead>
    <tbody>${ps.map(p => `<tr class="${isMe(p) ? 'me' : ''}"><th class="nm">${esc(first(p.name))}${isMe(p) ? ' (ich)' : ''}<small>${p.role === 'guest' ? 'Praktikum' : esc(p.name.split(' ').slice(1).join(' '))}</small></th>${ds.map(d => {
      const k = key(d), c = shiftOf(p.id, k), vis = c && (showRegular || !REGULAR.includes(c));
      return `<td class="cell ${cls(d)}" ${isMe(p) ? `data-editcell="${k}"` : ''}>${vis ? `<span class="mc" style="--c:${col(c)}" title="${esc(info(c).label)}">${esc(c)}</span>` : ''}</td>`;
    }).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}
function team() {
  const y = month.getFullYear(), m = month.getMonth();
  return hero('Wer ist wann wo', `${MON[m]} ${y}`) + `
  <div class="wrap">
    <section>
    <div class="mhead"><p class="eyebrow" style="margin:0">Zahl = im Büro (ohne C1, C2, BV)</p>
      <div class="navbtns"><button class="iconbtn" data-month="-1" aria-label="Vorheriger Monat">‹</button><button class="iconbtn" data-month="1" aria-label="Nächster Monat">›</button></div></div>
    <label class="toggle" style="border:0;padding-bottom:0"><span>Regeldienst einblenden<small>T und T½ sind normal und stehen deshalb nicht im Teamkalender</small></span><input type="checkbox" class="sw" id="showreg" ${showRegular ? 'checked' : ''}></label>
    <div class="seg" style="margin-top:12px"><button data-tmode="woche" aria-pressed="${teamMode === 'woche'}">Wochen</button><button data-tmode="monat" aria-pressed="${teamMode === 'monat'}">Monat</button></div>
    ${teamMode === 'woche'
      ? weeks(y, m) + '<p class="note">Leeres Feld an einem Werktag = Regeldienst. Tippe auf ein Datum für die Tagesansicht oder auf deine eigene Spalte, um deinen Dienst zu ändern.</p>'
      : monthTable(y, m) + '<p class="note">Wische seitlich durch den Monat. Tippe auf ein Datum für die Tagesansicht oder auf deine eigene Zeile, um deinen Dienst zu ändern.</p>'}
    </section>
    <section><p class="eyebrow">Dienstarten · # gilt als Frei, LD als LDF</p>
      <div class="codelegend">${Object.entries(CODES).map(([c, v]) => `<span><b style="--c:${col(c)}">${esc(c)}</b>${esc(v.label.replace('24-h-Dienst ', '24 h ').replace(' (Veranstaltung)', ''))}</span>`).join('')}</div></section>
  </div>`;
}

/* ---------- Mein Plan ---------- */
function plan() {
  const y = month.getFullYear(), m = month.getMonth();
  const firstD = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate(), lead = (firstD.getDay() + 6) % 7;
  const cells = [], counts = {};
  for (let i = 0; i < lead; i++) cells.push('<div></div>');
  for (let i = 1; i <= days; i++) {
    const d = new Date(y, m, i), k = key(d), c = shiftOf(store.me.id, k);
    if (c) counts[c] = (counts[c] || 0) + 1;
    const ap = apptsOn(k).length || eventsOn(k).length;
    cells.push(`<button class="day ${isWE(d) || holidayName(k) ? 'we' : ''} ${d.getTime() === TODAY.getTime() ? 'today' : ''}" data-edit="${k}" aria-label="${nice(d)}: ${c ? esc(info(c).label) : 'nichts eingetragen'}">
      <span class="n">${i}</span>${c ? `<span class="c" style="--c:${col(c)}">${esc(c)}</span>` : '<span></span>'}<span class="ap ${ap ? '' : 'none'}"></span></button>`);
  }
  const h24n = Object.entries(counts).filter(([c]) => is24(c)).reduce((s, [, n]) => s + n, 0);
  return hero('Mein Dienstplan', `${MON[m]} ${y}`) + `
  <div class="wrap">
    <section>
      <div class="mhead"><p class="eyebrow" style="margin:0">${(counts['T'] || 0) + (counts['T½'] || 0) + (counts['P-Spr'] || 0)} Tagdienste · ${h24n} × 24 h · ${counts['U'] || 0} Urlaub</p>
        <div class="navbtns"><button class="iconbtn" data-month="-1" aria-label="Vorheriger Monat">‹</button><button class="iconbtn" data-month="1" aria-label="Nächster Monat">›</button></div></div>
      <div class="grid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(x => `<div class="dow">${x}</div>`).join('')}${cells.join('')}</div>
      <p class="note">Tippe auf einen Tag, um den Dienst zu ändern oder einen Termin einzutragen. Ein Punkt bedeutet: Termin vorhanden.</p>
    </section>
    <section>
      <button class="btn block" data-act="ics-month">Dienste im ${MON[m]} für Outlook herunterladen</button>
      <p class="note">Ohne T und T½: Im Outlook-Kalender bist du an normalen Tagen frei für Termine. Die Datei in Outlook öffnen oder unter outlook.office.com → Kalender hinzufügen → „Aus Datei hochladen“.</p>
    </section>
  </div>`;
}
function editSheet(k) {
  const d = parse(k), c = shiftOf(store.me.id, k), appts = apptsOn(k);
  const chip = x => `<button class="chip" data-sheetset="${esc(x)}" style="--c:${col(x)}" aria-pressed="${c === x}"><span class="dot"></span>${esc(x)}</button>`;
  openSheet(`
    <h2>${nice(d)}</h2><p class="sub">${c ? esc(info(c).label) + (is24(c) ? ' · 08:00 bis 08:00 am Folgetag' : '') : 'Nichts eingetragen'}${holidayName(k) ? ' · ' + esc(holidayName(k)) : ''}</p>
    <div class="chips-label">Dienst</div>
    <div class="chips">${[...QUICK, ...H24, ...OFF].map(chip).join('')}</div>
    <div class="chips-label" style="margin-top:20px">Meine Termine · nur für dich sichtbar</div>
    ${appts.length ? appts.map(a => `<div class="appt"><div><strong>${esc(a.title || 'Privat')}</strong><br><small>${hm(a.t_from)} bis ${hm(a.t_to)}${a.in_feed ? ' · im privaten Kalender' : ''}</small></div>
      <div style="display:flex;gap:6px"><button class="btn small ghost" data-act="ics-appt" data-id="${a.id}">Outlook</button><button class="linkbtn" data-act="del-appt" data-id="${a.id}">Löschen</button></div></div>`).join('') : '<p class="note" style="margin-top:0">Noch keine Termine an diesem Tag.</p>'}
    <form id="apptform">
      <div class="row2"><div class="field"><label for="a-from">Von</label><input id="a-from" type="time" value="09:00" required></div><div class="field"><label for="a-to">Bis</label><input id="a-to" type="time" value="10:00" required></div></div>
      <div class="field"><label for="a-title">Titel (freiwillig)</label><input id="a-title" maxlength="120" placeholder="Leer lassen = „Privat“"></div>
      <label class="toggle" style="border:0;padding-bottom:0"><span>In meinen privaten Kalender übernehmen<small>Erscheint im persönlichen Kalender-Abo</small></span><input id="a-feed" type="checkbox" class="sw" checked></label>
      <div id="a-err" class="err" hidden></div>
      <div class="stack"><button class="btn block" type="submit">Termin speichern</button></div>
    </form>`, root => {
    root.querySelectorAll('[data-sheetset]').forEach(b => b.onclick = safely(async () => {
      const v = b.dataset.sheetset; await api.setShift(store.me.id, k, shiftOf(store.me.id, k) === v ? '' : v); closeSheet(); editSheet(k);
    }));
    root.querySelector('#apptform').onsubmit = safely(async e => {
      e.preventDefault();
      const f = root.querySelector('#a-from').value, t = root.querySelector('#a-to').value, err = root.querySelector('#a-err');
      if (mins(t) <= mins(f)) { err.textContent = 'Die Endzeit muss nach der Startzeit liegen.'; err.hidden = false; return; }
      await api.addAppt({ day: k, t_from: f, t_to: t, title: root.querySelector('#a-title').value.trim() || null, in_feed: root.querySelector('#a-feed').checked });
      closeSheet(); editSheet(k); toast('Termin gespeichert');
    });
  });
}

/* ---------- Autos ---------- */
const T0 = 6 * 60, T1 = 22 * 60;
function autos() {
  const d = parse(carDay), now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
  const strip = [...Array(7)].map((_, i) => addDays(TODAY, i));
  return hero('Fahrzeuge', nice(d), `
    <div class="week">${strip.map(w => { const k = key(w), n = bookingsOn(k).length;
      return `<button class="wd ${k === carDay ? 'sel' : ''} ${w.getTime() === TODAY.getTime() ? 'today' : ''}" data-carday="${k}"><small>${DOW[w.getDay()]}</small><strong>${w.getDate()}</strong><i>${n ? n + ' Buch.' : 'frei'}</i></button>`; }).join('')}</div>`) + `
  <div class="wrap">
    <section><div class="cars">${CARS.map((car, ci) => {
      const bs = bookingsOn(carDay, ci);
      const busyNow = carDay === todayKey() && bs.find(b => mins(b.t_from) <= nowM && nowM < mins(b.t_to));
      return `<article class="car">
        <div class="car-head"><div><h3>${esc(car.name)}</h3>${car.model ? `<small style="color:var(--muted)">${esc(car.model)}</small>` : ''}</div>${car.plate ? `<span class="plate">${esc(car.plate)}</span>` : ''}</div>
        <div class="free" style="margin-top:8px"><i class="dot" style="background:var(${busyNow ? '--danger' : '--g-buero'})"></i>${busyNow ? `Unterwegs mit ${esc(nameOf(busyNow.user_id))} bis ${hm(busyNow.t_to)}` : (bs.length ? `${bs.length} ${bs.length === 1 ? 'Buchung' : 'Buchungen'} an diesem Tag` : 'Den ganzen Tag frei')}</div>
        <div class="timeline">${bs.map(b => { const l = (Math.max(mins(b.t_from), T0) - T0) / (T1 - T0) * 100, w = (Math.min(mins(b.t_to), T1) - Math.max(mins(b.t_from), T0)) / (T1 - T0) * 100;
          return w > 0 ? `<div class="slot ${b.user_id === store.me.id ? 'mine' : ''}" style="left:${l}%;width:${w}%">${esc(nameOf(b.user_id))}</div>` : ''; }).join('')}
          ${carDay === todayKey() && nowM > T0 && nowM < T1 ? `<div class="now" style="left:${(nowM - T0) / (T1 - T0) * 100}%"></div>` : ''}</div>
        <div class="ticks"><span>6</span><span>10</span><span>14</span><span>18</span><span>22 Uhr</span></div>
        ${bs.length ? `<div class="blist">${bs.map(b => `<div class="brow"><span><strong>${b.user_id === store.me.id ? 'Ich' : esc(nameOf(b.user_id))}</strong>${b.ziel ? ' · ' + esc(b.ziel) : ''}</span><span>${hm(b.t_from)} bis ${hm(b.t_to)}${b.user_id === store.me.id || isAdmin() ? ` <button class="linkbtn" data-act="del-book" data-id="${b.id}">Stornieren</button>` : ''}</span></div>`).join('')}</div>` : ''}
      </article>`; }).join('')}
    </div></section>
    <section>${isGuest() ? '<p class="note">Als Praktikantin oder Praktikant kannst du sehen, wann ein Auto frei ist. Reservieren können nur Teammitglieder.</p>'
      : '<button class="btn block" data-act="book">Auto reservieren</button><p class="note">Reservierungen sehen alle sofort. Doppelbuchungen sind nicht möglich.</p>'}</section>
  </div>`;
}
function bookSheet() {
  let car = 0;
  openSheet(`
    <h2>Auto reservieren</h2><p class="sub">Für ${esc(store.me.name)} · alle sehen die Reservierung</p>
    <div class="chips-label">Fahrzeug</div>
    <div class="seg">${CARS.map((c, i) => `<button type="button" data-car="${i}" aria-pressed="${i === 0}">${esc(c.name)}${c.model ? `<br><small style="font-weight:500">${esc(c.model)}</small>` : ''}</button>`).join('')}</div>
    <form id="bookform">
      <div class="field"><label for="b-date">Datum</label><input id="b-date" type="date" value="${carDay}" min="${todayKey()}" required></div>
      <div class="row2"><div class="field"><label for="b-from">Von</label><input id="b-from" type="time" value="09:00" required></div><div class="field"><label for="b-to">Bis</label><input id="b-to" type="time" value="12:00" required></div></div>
      <div class="field"><label for="b-ziel">Ziel (freiwillig)</label><input id="b-ziel" maxlength="120" placeholder="z. B. Außentermin"></div>
      <div id="b-err" class="err" hidden></div>
      <div class="stack"><button class="btn block" type="submit">Reservieren</button></div>
    </form>`, root => {
    root.querySelectorAll('[data-car]').forEach(b => b.onclick = () => { car = Number(b.dataset.car); root.querySelectorAll('[data-car]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    root.querySelector('#bookform').onsubmit = async e => {
      e.preventDefault();
      const day = root.querySelector('#b-date').value, f = root.querySelector('#b-from').value, t = root.querySelector('#b-to').value, err = root.querySelector('#b-err');
      const show = m => { err.textContent = m; err.hidden = false; };
      if (mins(t) <= mins(f)) return show('Die Endzeit muss nach der Startzeit liegen.');
      await api.ensureMonths([day.slice(0, 7)]);
      const clash = bookingsOn(day, car).find(b => mins(f) < mins(b.t_to) && mins(b.t_from) < mins(t));
      if (clash) return show(`${CARS[car].name} ist von ${hm(clash.t_from)} bis ${hm(clash.t_to)} schon von ${nameOf(clash.user_id)} reserviert.${CARS.length > 1 ? ` Nimm ${CARS[1 - car].name} oder eine andere Zeit.` : ''}`);
      try {
        await api.addBooking({ car, day, t_from: f, t_to: t, ziel: root.querySelector('#b-ziel').value.trim() || null });
        carDay = day; closeSheet(); render(); toast(`${CARS[car].name} reserviert: ${f} bis ${t} Uhr`);
      } catch (ex) { show(errText(ex)); }
    };
  });
}

/* ---------- Teamtermin ---------- */
function evSheet() {
  openSheet(`
    <h2>Teamtermin eintragen</h2><p class="sub">Für alle sichtbar, z. B. Abteilungsbesprechung oder Veranstaltung</p>
    <form id="evform">
      <div class="field"><label for="e-title">Was</label><input id="e-title" required maxlength="120" placeholder="z. B. Abteilungsbesprechung"></div>
      <div class="row2"><div class="field"><label for="e-date">Datum</label><input id="e-date" type="date" value="${selDay}" required></div>
      <div class="field"><label for="e-time">Uhrzeit (freiwillig)</label><input id="e-time" type="time"></div></div>
      <div class="stack"><button class="btn block" type="submit">Für alle eintragen</button></div>
    </form>`, root => {
    root.querySelector('#evform').onsubmit = safely(async e => {
      e.preventDefault();
      const t = root.querySelector('#e-title').value.trim(); if (!t) return;
      await api.addEvent(root.querySelector('#e-date').value, root.querySelector('#e-time').value, t);
      closeSheet(); toast('Teamtermin eingetragen. Alle sehen ihn jetzt.');
    });
  });
}

/* ---------- Ich ---------- */
function ich() {
  const f = store.feed, url = f ? `${api.feedBase}?token=${f.token}` : '';
  const webcal = url.replace(/^https?:/, 'webcal:');
  const allOn = f && f.codes.length === ALL_CODES.length;
  return hero('Angemeldet als', esc(store.me.name)) + `
  <div class="wrap">
    ${f ? `<section>
      <p class="eyebrow">Mein privater Kalender</p>
      <div class="card">
        <p style="margin:0 0 10px">Diesen Link einmal abonnieren. Danach stehen deine Dienste automatisch in deinem Kalender und aktualisieren sich von selbst (meist innerhalb weniger Stunden).</p>
        <div class="stack" style="margin-top:0">
          <a class="btn block" href="https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent('Meine Dienste')}" target="_blank" rel="noopener">In Outlook abonnieren</a>
          <a class="btn ghost block" href="${esc(webcal)}">iPhone / Mac abonnieren</a>
          <a class="btn ghost block" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}" target="_blank" rel="noopener">In Google Kalender abonnieren</a>
          <button class="btn ghost block" data-act="copy-feed">Link kopieren</button>
        </div>
        <div class="chips-label" style="margin-top:16px">Was soll in deinem privaten Kalender stehen?</div>
        <div class="chips">${ALL_CODES.map(c => `<button class="chip" data-feedcode="${esc(c)}" style="--c:${col(c)}" aria-pressed="${f.codes.includes(c)}"><span class="dot"></span>${esc(c)}</button>`).join('')}</div>
        <div class="chips" style="margin-top:8px"><button class="btn small ghost" data-act="feed-all">Alles</button><button class="btn small ghost" data-act="feed-dev">Nur Abweichungen</button></div>
        <p class="note">${allOn ? 'Alles ausgewählt, auch T und Frei.' : `${f.codes.length} von ${ALL_CODES.length} Dienstarten ausgewählt.`}</p>
        <label class="toggle"><span>Teamtermine<small>z. B. Abteilungsbesprechung</small></span><input type="checkbox" class="sw" id="f-t" ${f.include_team ? 'checked' : ''}></label>
        <label class="toggle"><span>Meine Termine<small>Nur Termine, bei denen du es eingeschaltet hast</small></span><input type="checkbox" class="sw" id="f-a" ${f.include_appts ? 'checked' : ''}></label>
      </div>
      <p class="note">Der Link gehört nur dir. Wer ihn hat, kann lesen, was du oben ausgewählt hast. Gib ihn nicht weiter. <button class="linkbtn" data-act="reset-feed">Neuen Link erzeugen</button> (der alte funktioniert dann nicht mehr).</p>
    </section>` : ''}
    ${isAdmin() ? adminSection() : ''}
    ${isGuest() ? '' : importSection()}
    <section>
      <div class="stack">
        <button class="btn ghost block" data-act="privacy">Datenschutzhinweis</button>
        <button class="btn ghost block" data-act="logout">Abmelden</button>
      </div>
    </section>
  </div>`;
}
function adminSection() {
  const ps = store.profiles;
  const pending = store.invites.filter(i => !i.claimed_at);
  return `<section>
    <p class="eyebrow">Team verwalten · nur für Admins</p>
    <div class="card">
      ${ps.map(p => `<div class="guest-row"><div><strong>${esc(p.name)} <span class="code" style="--c:var(${p.role === 'guest' ? '--g-gast' : '--g-buero'});font-size:11px">${esc(p.ini)}</span></strong>
        <small>${p.role === 'admin' ? 'Admin' : p.role === 'guest' ? `Praktikum bis ${nice(parse(p.guest_until))}${p.guest_until < todayKey() ? ' · abgelaufen' : ''}` : 'Team'}</small></div>
        ${p.id !== store.me.id ? `<button class="linkbtn" data-act="remove" data-id="${p.id}" data-name="${esc(p.name)}">Entfernen</button>` : ''}</div>`).join('')}
      ${pending.length ? `<div class="chips-label">Eingeladen, noch nicht angemeldet</div>${pending.map(i => `<div class="guest-row"><div><strong>${esc(i.name)}</strong><small>${esc(i.email)}${i.role === 'guest' ? ` · Praktikum bis ${nice(parse(i.guest_until))}` : ''}</small></div><button class="linkbtn" data-act="del-invite" data-email="${esc(i.email)}">Zurückziehen</button></div>`).join('')}` : ''}
      <form id="inviteform" style="border-top:1px solid var(--line);margin-top:6px">
        <div class="chips-label">Person einladen</div>
        <div class="row2"><div class="field"><label for="i-name">Name</label><input id="i-name" required maxlength="80" placeholder="Vor- und Nachname"></div>
        <div class="field"><label for="i-ini">Kürzel</label><input id="i-ini" required maxlength="4" placeholder="z. B. HG" style="text-transform:uppercase"></div></div>
        <div class="field"><label for="i-email">E-Mail-Adresse</label><input id="i-email" type="email" required placeholder="name@beispiel.de"></div>
        <div class="row2"><div class="field"><label for="i-role">Rolle</label><select id="i-role"><option value="member">Team</option><option value="guest">Praktikum (Gast)</option><option value="admin">Admin</option></select></div>
        <div class="field"><label for="i-until">Praktikum bis</label><input id="i-until" type="date" value="${key(addDays(TODAY, 28))}"></div></div>
        <div class="stack"><button class="btn block" type="submit">Einladen</button></div>
        <p class="note">Danach schickst du der Person den Link zur App. Sie meldet sich mit genau dieser E-Mail-Adresse an. Praktikums-Zugänge enden automatisch am eingetragenen Tag.</p>
      </form>
    </div>
  </section>
`;
}
function importSection() {
  return `<section>
    <p class="eyebrow">Dienstplan aus Excel übernehmen</p>
    <label class="drop" for="upload"><strong>Excel-Datei auswählen (.xlsx)</strong><small>${isAdmin()
      ? 'Als Admin übernimmst du die Spalten aller Personen.'
      : `Übernommen wird nur deine eigene Spalte (${esc(store.me.ini)}).`} Die Datei wird nur auf diesem Gerät gelesen. Pro Blatt ein Monat, Zeilen = Tage, Spalten = Kürzel.</small></label>
    <input id="upload" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
    <div id="importres"></div>
  </section>`;
}
function privacySheet() {
  openSheet(`
    <h2>Datenschutzhinweis</h2><p class="sub">Dienstbrett · ${esc(ORG)}</p>
    <div class="prose">
      <p><b>Was gespeichert wird:</b> Name und Kürzel, deine Dienstkürzel pro Tag, Auto-Reservierungen, Teamtermine, deine eigenen Termine (Uhrzeit und, falls du willst, ein Titel) und deine Einstellungen für das Kalender-Abo. Für die Anmeldung zusätzlich deine E-Mail-Adresse.</p>
      <p><b>Wer was sieht:</b> Dienste, Auto-Reservierungen und Teamtermine sieht das ganze Team inklusive Praktikum. Deine eigenen Termine sieht nur du. Die E-Mail-Adressen sehen nur Admins.</p>
      <p><b>Was nicht gespeichert wird:</b> Krankmeldungen, Gesundheitsdaten, Standorte. Es gibt keine Werbung, kein Tracking und keine KI-Auswertung.</p>
      <p><b>Wo:</b> Bei unserem Datenbank-Anbieter auf Servern in der EU (Frankfurt), verschlüsselt übertragen. Der Zugriff ist durch Zugriffsregeln in der Datenbank selbst beschränkt.</p>
      <p><b>Wie lange:</b> Dienste 13 Monate, Teamtermine und Auto-Reservierungen 3 Monate, eigene Termine 1 Monat nach dem Datum. Praktikums-Zugänge werden 30 Tage nach Ende gelöscht. Wer das Team verlässt, wird mit allen Daten gelöscht.</p>
      <p><b>Deine Rechte:</b> Du kannst Auskunft, Berichtigung und Löschung verlangen.${PRIVACY_CONTACT ? ` Ansprechperson: ${esc(PRIVACY_CONTACT)}.` : ''}</p>
    </div>
    <div class="stack"><button class="btn block" data-act="close-sheet">Verstanden</button></div>`);
}

/* ---------- Excel-Import ---------- */
async function handleImport(file) {
  const out = document.getElementById('importres');
  out.innerHTML = '<p class="note">Lese Datei …</p>';
  try {
    const [{ readXlsx }, { parseSheet }] = await Promise.all([import('./xlsx.js'), import('./importer.js')]);
    const sheets = await readXlsx(await file.arrayBuffer());
    const year = TODAY.getFullYear();
    // Teammitglieder übernehmen nur ihre eigene Spalte (die Datenbank erlaubt ohnehin nichts anderes)
    const who = isAdmin() ? store.profiles : store.profiles.filter(p => p.id === store.me.id);
    const results = sheets.map(s => ({ s, r: parseSheet(s, who, year, { fillRegular: true }) })).filter(x => x.r.month >= 0 || x.r.error);
    const ok = results.filter(x => !x.r.error);
    const unknown = {}; ok.forEach(x => Object.entries(x.r.unknown).forEach(([k, n]) => unknown[k] = (unknown[k] || 0) + n));
    const entries = ok.flatMap(x => x.r.entries);
    out.innerHTML = `<div class="card" style="margin-top:12px">
      <div class="field" style="margin-top:0"><label for="imp-year">Jahr</label><input id="imp-year" type="number" value="${year}" min="2020" max="2100"></div>
      ${ok.map(x => `<p style="margin:10px 0 0"><strong>${MON[x.r.month]}</strong>: ${x.r.entries.length} Einträge für ${x.r.columns.map(c => esc(c.person.ini)).join(', ')}</p>`).join('')}
      ${results.filter(x => x.r.error).map(x => `<p class="note">${esc(x.r.error)}</p>`).join('')}
      ${isAdmin() && [...new Set(ok.flatMap(x => x.r.unmatched))].length ? `<div class="warn">Diese Spalten gehören zu niemandem in der App und werden übersprungen: <b>${[...new Set(ok.flatMap(x => x.r.unmatched))].map(esc).join(', ')}</b>. Lade die Personen zuerst ein; sie müssen sich einmal angemeldet haben.</div>` : ''}
      ${Object.keys(unknown).length ? `<div class="warn">Diese Kürzel kennt die App nicht und lässt sie weg: <b>${Object.entries(unknown).map(([k, n]) => `${esc(k)} (${n}×)`).join(', ')}</b></div>` : ''}
      <label class="toggle"><span>Leere Werktage als T eintragen<small>In der Excel heißt ein leeres Feld: Regeldienst</small></span><input type="checkbox" class="sw" id="imp-fill" checked></label>
      <div class="stack"><button class="btn block" id="imp-go" ${entries.length ? '' : 'disabled'}>Übernehmen</button></div>
      <p class="note">Bestehende Einträge an diesen Tagen werden überschrieben.</p></div>`;
    document.getElementById('imp-go').onclick = safely(async () => {
      const y = Number(document.getElementById('imp-year').value), fill = document.getElementById('imp-fill').checked;
      const rows = sheets.flatMap(s => { const r = parseSheet(s, who, y, { fillRegular: fill }); return r.error ? [] : r.entries; });
      await api.upsertShifts(rows);
      out.innerHTML = ''; toast(`${rows.length} Dienste übernommen`);
    });
  } catch (e) { console.error(e); out.innerHTML = `<div class="warn">${esc(e.message || 'Die Datei konnte nicht gelesen werden.')} Bitte als .xlsx speichern und erneut versuchen.</div>`; }
}

/* ---------- Sheet ---------- */
let lastFocus = null;
function openSheet(html, bind) {
  lastFocus = document.activeElement;
  $layer.innerHTML = `<div class="scrim" id="scrim"><div class="sheet wrap" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const scrim = document.getElementById('scrim');
  scrim.addEventListener('click', e => { if (e.target === scrim) closeSheet(); });
  bind && bind(scrim.querySelector('.sheet'));
  scrim.querySelector('input,button')?.focus({ preventScroll: true });
}
function closeSheet() { $layer.innerHTML = ''; lastFocus?.focus?.({ preventScroll: true }); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ---------- Render ---------- */
function monthsNeeded() {
  const ms = new Set([monthKey(TODAY)]);
  const add = (from, n) => { for (let i = 0; i <= n; i++) ms.add(monthKey(addDays(from, i))); };
  if (view === 'heute') { const d = parse(selDay); add(addDays(d, -8), 16); }
  if (view === 'team' || view === 'plan') add(addDays(month, -7), 45);
  if (view === 'autos') add(TODAY, 7);
  return [...ms];
}
let renderQueued = false;
function scheduleRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); } }
function render() {
  const sy = window.scrollY, mw = document.getElementById('mxwrap')?.scrollLeft;
  api.ensureMonths(monthsNeeded()).then(changed => changed && scheduleRender()).catch(e => toast(errText(e)));
  $app.innerHTML = view === 'heute' ? heute() : view === 'team' ? team() : view === 'plan' ? plan() : view === 'autos' ? autos() : ich();
  renderTabs();
  const w = document.getElementById('mxwrap');
  if (w) w.scrollLeft = mw ?? Math.max(0, (document.getElementById('mxtoday')?.offsetLeft || 0) - 140);
  window.scrollTo(0, sy);
  bindView();
}
function go(v) { view = v; render(); window.scrollTo(0, 0); }

function bindView() {
  const sr = document.getElementById('showreg'); if (sr) sr.onchange = () => { showRegular = sr.checked; render(); };
  const ft = document.getElementById('f-t'); if (ft) ft.onchange = safely(() => api.updateFeed({ include_team: ft.checked }));
  const fa = document.getElementById('f-a'); if (fa) fa.onchange = safely(() => api.updateFeed({ include_appts: fa.checked }));
  const up = document.getElementById('upload'); if (up) up.onchange = () => up.files[0] && handleImport(up.files[0]);
  const inv = document.getElementById('inviteform');
  if (inv) inv.onsubmit = safely(async e => {
    e.preventDefault();
    const role = document.getElementById('i-role').value;
    const row = { name: document.getElementById('i-name').value.trim(), ini: document.getElementById('i-ini').value.trim().toUpperCase(),
      email: document.getElementById('i-email').value.trim().toLowerCase(), role, guest_until: role === 'guest' ? document.getElementById('i-until').value : null };
    await api.invite(row);
    copy(`Hallo ${first(row.name)}, hier ist der Link zu unserem Dienstbrett: ${location.origin}${location.pathname} – melde dich mit ${row.email} an.`, `${row.name} eingeladen. Eine Nachricht mit dem Link ist kopiert und kann verschickt werden.`);
  });
}

document.addEventListener('click', async e => {
  if (!store.me) return;
  const cell = e.target.closest('[data-editcell]'); if (cell) { editSheet(cell.dataset.editcell); return; }
  const b = e.target.closest('button'); if (!b) return;
  const ds = b.dataset;
  if (ds.tab) return go(ds.tab);
  if (ds.day) { selDay = ds.day; return render(); }
  if (ds.carday) { carDay = ds.carday; return render(); }
  if (ds.tmode) { teamMode = ds.tmode; return render(); }
  if (ds.month) { month = new Date(month.getFullYear(), month.getMonth() + Number(ds.month), 1); return render(); }
  if (ds.edit) return editSheet(ds.edit);
  if (ds.jump) { selDay = ds.jump; return go('heute'); }
  if (ds.set !== undefined) return safely(async () => {
    const cur = shiftOf(store.me.id, selDay);
    await api.setShift(store.me.id, selDay, cur === ds.set ? '' : ds.set);
    toast(cur === ds.set ? 'Eintrag entfernt' : `${info(ds.set).label} eingetragen. Alle sehen es jetzt.`);
  })();
  if (ds.feedcode) return safely(async () => {
    const c = ds.feedcode, codes = store.feed.codes.includes(c) ? store.feed.codes.filter(x => x !== c) : [...store.feed.codes, c];
    await api.updateFeed({ codes });
  })();
  const one = id => store.events.get(id) || store.appts.get(id);
  switch (ds.act) {
    case 'book': return bookSheet();
    case 'add-ev': return evSheet();
    case 'close-sheet': return closeSheet();
    case 'privacy': return privacySheet();
    case 'del-book': return safely(async () => { await api.deleteBooking(ds.id); toast('Reservierung storniert'); })();
    case 'del-ev': return safely(async () => { await api.deleteEvent(ds.id); toast('Teamtermin gelöscht'); })();
    case 'del-appt': return safely(async () => { const a = store.appts.get(ds.id); await api.deleteAppt(ds.id); closeSheet(); if (a) editSheet(a.day); })();
    case 'ics-ev': { const ev = one(ds.id); return download(`teamtermin-${ev.day}.ics`, buildCalendar('Teamtermin', [eventItem(ev)])); }
    case 'ics-appt': { const a = one(ds.id); return download(`termin-${a.day}.ics`, buildCalendar('Termin', [apptItem(a)])); }
    case 'ics-month': {
      const y = month.getFullYear(), m = month.getMonth(), n = new Date(y, m + 1, 0).getDate(), items = [];
      for (let i = 1; i <= n; i++) { const k = key(new Date(y, m, i)), c = shiftOf(store.me.id, k); if (c && !REGULAR.includes(c)) items.push(shiftItem(store.me.id.slice(0, 8), k, c)); }
      if (!items.length) return toast(`Im ${MON[m]} gibt es keine Abweichungen vom Regeldienst.`);
      download(`dienste-${y}-${pad(m + 1)}.ics`, buildCalendar('Dienste', items));
      return toast(`${items.length} Einträge heruntergeladen. Jetzt die Datei öffnen, um sie in Outlook zu übernehmen.`);
    }
    case 'copy-feed': return copy(`${api.feedBase}?token=${store.feed.token}`, 'Link kopiert');
    case 'reset-feed': return safely(async () => { await api.resetFeedToken(); toast('Neuer Link erzeugt. Abonniere ihn neu, der alte funktioniert nicht mehr.'); })();
    case 'feed-all': return safely(() => api.updateFeed({ codes: [...ALL_CODES] }))();
    case 'feed-dev': return safely(() => api.updateFeed({ codes: ALL_CODES.filter(c => !REGULAR.includes(c)) }))();
    case 'del-invite': return safely(() => api.deleteInvite(ds.email))();
    case 'remove': {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Wirklich? Alle Daten werden gelöscht'; return; }
      return safely(async () => { await api.removeMember(ds.id); toast(`${ds.name} wurde entfernt.`); })();
    }
    case 'logout': await api.sb.auth.signOut(); location.reload(); return;
  }
});

/* ---------- Anmeldung ---------- */
function loginView(msg = '') {
  $tabs.parentElement.hidden = true;
  $app.innerHTML = `
  <div class="login wrap">
    <div class="brand"><div class="logo" aria-hidden="true">D</div><h1>Dienstbrett</h1><p>Wer ist wann da, wer hat welches Auto. Für ${esc(ORG)}.</p></div>
    <form id="mailform" class="card">
      <div class="field" style="margin-top:0"><label for="l-mail">Deine E-Mail-Adresse</label><input id="l-mail" type="email" autocomplete="email" required placeholder="name@beispiel.de"></div>
      <div class="stack"><button class="btn block" type="submit">Anmeldecode schicken</button></div>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <p class="note">Du bekommst einen Code per E-Mail. Danach bleibst du auf diesem Gerät angemeldet.</p>
    </form>
  </div>`;
  document.getElementById('mailform').onsubmit = async e => {
    e.preventDefault();
    const email = document.getElementById('l-mail').value.trim().toLowerCase();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Wird gesendet …';
    const { error } = await api.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
    if (error) return loginView(/rate|seconds/i.test(error.message) ? 'Bitte warte kurz, bevor du einen neuen Code anforderst.' : 'Der Code konnte nicht gesendet werden. Prüfe die Adresse.');
    codeView(email);
  };
}
function codeView(email, msg = '') {
  $app.innerHTML = `
  <div class="login wrap">
    <div class="brand"><div class="logo" aria-hidden="true">D</div><h1>E-Mail prüfen</h1><p>Wir haben dir eine E-Mail an <b>${esc(email)}</b> geschickt. Gib den Code daraus hier ein oder tippe in der E-Mail auf den Anmelde-Link. Schau auch im Spam-Ordner nach.</p></div>
    <form id="codeform" class="card">
      <div class="field" style="margin-top:0"><label for="l-code">Code aus der E-Mail</label><input id="l-code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6,8}" maxlength="8" class="codeinput"></div>
      <div class="stack"><button class="btn block" type="submit">Anmelden</button><button type="button" class="btn ghost block" id="back">Andere Adresse</button></div>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    </form>
  </div>`;
  document.getElementById('back').onclick = () => loginView();
  document.getElementById('codeform').onsubmit = async e => {
    e.preventDefault();
    const token = document.getElementById('l-code').value.trim();
    const { error } = await api.sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) return codeView(email, 'Der Code stimmt nicht oder ist abgelaufen.');
    once();
  };
}
function noAccessView() {
  $tabs.parentElement.hidden = true;
  $app.innerHTML = `<div class="login wrap"><div class="brand"><div class="logo" aria-hidden="true">D</div><h1>Kein Zugang</h1>
    <p>Für diese E-Mail-Adresse gibt es keine Einladung, oder dein Praktikums-Zugang ist abgelaufen. Bitte melde dich bei der Person, die das Dienstbrett verwaltet.</p></div>
    <div class="card"><button class="btn ghost block" id="out">Mit anderer Adresse anmelden</button></div></div>`;
  document.getElementById('out').onclick = async () => { await api.sb.auth.signOut(); loginView(); };
}

async function start() {
  try {
    const me = await api.boot();
    if (!me) return noAccessView();
    api.setOnChange(scheduleRender);
    render();
    try { if (!localStorage.getItem('db-privacy-seen')) { privacySheet(); localStorage.setItem('db-privacy-seen', '1'); } } catch { /* privater Modus */ }
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="login wrap"><div class="brand"><h1>Verbindung fehlgeschlagen</h1><p>${esc(errText(e))}</p></div><div class="card"><button class="btn block" onclick="location.reload()">Erneut versuchen</button></div></div>`;
  }
}

// Mitternacht: "Heute" weiterschalten
setInterval(() => { const t = new Date(); t.setHours(0, 0, 0, 0); if (t.getTime() !== TODAY.getTime()) { TODAY = t; if (store.me) render(); } }, 60000);

let started = false;
function once() { if (!started) { started = true; history.replaceState(null, '', location.pathname); start(); } }

if (!api.configured) {
  $tabs.parentElement.hidden = true;
  $app.innerHTML = '<div class="login wrap"><div class="brand"><h1>Noch nicht eingerichtet</h1><p>Es fehlen die Zugangsdaten zur Datenbank (VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY). Siehe Anleitung in der README.</p></div></div>';
} else {
  // Anmeldung per Code oder per Link aus der E-Mail (der Link landet mit der Sitzung in der Adresse)
  api.sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_IN' && session && !document.getElementById('codeform')) setTimeout(once, 0); });
  api.sb.auth.getSession().then(({ data }) => data.session ? once() : loginView());
}

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
