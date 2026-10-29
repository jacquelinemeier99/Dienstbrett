// Wandelt eine Tabelle im Stil der Team-Excel in Dienst-Einträge um:
// Zeilen = Tage, Spalten = Personen (Kürzel wie HG, FK, JM), Zellen = Dienstkürzel.
import { normalize } from '../supabase/functions/_shared/codes.js';
import { holidayName } from './holidays.js';

export const MONTHS = ['januar','februar','märz','april','mai','juni','juli','august','september','oktober','november','dezember'];
const pad = (n) => String(n).padStart(2, '0');

export function findMonth(sheet) {
  const probe = [sheet.name, ...sheet.rows.slice(0, 6).flat()].map(x => String(x || '').toLowerCase());
  for (const p of probe) {
    const i = MONTHS.findIndex(m => p.includes(m) || (m === 'märz' && p.includes('maerz')));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * @param sheet   { name, rows }
 * @param people  [{ id, ini }]
 * @param year    z. B. 2026
 * @param opts    { fillRegular: leere Werktage als T eintragen }
 * @returns { month, columns:[{col, person}], entries:[{user_id, day, code}], unknown:{code:count}, unmatched:[Kürzel ohne Person], error? }
 */
export function parseSheet(sheet, people, year, opts = {}) {
  const month = findMonth(sheet);
  if (month < 0) return { error: `Im Blatt „${sheet.name}“ steht kein Monatsname.` };
  const byIni = new Map(people.map(p => [p.ini.trim().toUpperCase(), p]));

  // Kopfzeile = die Zeile (in den ersten 12) mit den meisten bekannten Personen-Kürzeln
  let headerRow = -1, columns = [];
  for (let r = 0; r < Math.min(sheet.rows.length, 12); r++) {
    const cols = (sheet.rows[r] || []).map((v, col) => ({ col, person: byIni.get(String(v).trim().toUpperCase()) })).filter(x => x.person);
    if (cols.length > columns.length) { headerRow = r; columns = cols; }
  }
  if (headerRow < 0) return { error: `Im Blatt „${sheet.name}“ wurde keine Kopfzeile mit euren Kürzeln gefunden.`, month };
  const unmatched = (sheet.rows[headerRow] || [])
    .filter((v, col) => /^[A-ZÄÖÜ]{1,4}$/i.test(String(v).trim()) && !columns.some(c => c.col === col) && !/^b(ü|ue)ro$/i.test(String(v).trim()))
    .map(v => String(v).trim());

  const days = new Date(year, month + 1, 0).getDate();
  const entries = [], unknown = {};
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    let d = NaN;
    for (let c = 0; c < Math.min(3, row.length) && isNaN(d); c++) {
      const m = /^(\d{1,2})(?!\d)/.exec(String(row[c] || '').trim());
      if (m) d = Number(m[1]);
    }
    if (!(d >= 1 && d <= days)) continue;
    const date = new Date(year, month, d), day = `${year}-${pad(month + 1)}-${pad(d)}`;
    const workday = date.getDay() !== 0 && date.getDay() !== 6 && !holidayName(day);
    for (const { col, person } of columns) {
      const raw = row[col];
      const code = normalize(raw);
      if (code === null) { const k = String(raw).trim(); unknown[k] = (unknown[k] || 0) + 1; continue; }
      if (code) entries.push({ user_id: person.id, day, code });
      else if (opts.fillRegular && workday) entries.push({ user_id: person.id, day, code: 'T' });
    }
  }
  return { month, columns, entries, unknown, unmatched };
}
