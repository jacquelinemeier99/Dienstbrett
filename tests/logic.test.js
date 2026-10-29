// Tests für Import, Kürzel und Kalenderdateien: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../supabase/functions/_shared/codes.js';
import { buildCalendar, shiftItem, apptItem } from '../supabase/functions/_shared/ics.js';
import { parseSheet } from '../src/importer.js';
import { holidayName } from '../src/holidays.js';

test('Kürzel aus der Excel werden vereinheitlicht', () => {
  assert.equal(normalize('#'), 'Frei');
  assert.equal(normalize('LD'), 'LDF');
  assert.equal(normalize('-C1-'), 'C1');
  assert.equal(normalize(' HO '), 'HO');
  assert.equal(normalize(''), '');
  assert.equal(normalize('K'), null);          // z. B. krank: wird bewusst nicht übernommen
});

test('Feiertage', () => {
  assert.equal(holidayName('2026-10-03'), 'Tag der Dt. Einheit');
  assert.equal(holidayName('2026-04-06'), 'Ostermontag');
  assert.equal(holidayName('2026-10-29'), '');
});

test('Excel-Blatt wird gelesen', () => {
  const sheet = { name: 'Oktober', rows: [
    ['Oktober'], [],
    ['', '', 'HG', 'JM', 'ZZ', 'Büro'],
    ['1', 'Do', 'R', '', 'T', '2'],
    ['2', 'Fr', '', 'LD', '', '3'],
    ['3', 'Sa', '', 'C1', '', '2'],
    ['4', 'So', '', '', '', '2'],
    ['5', 'Mo', 'K', '#', '', '4'],
  ] };
  const people = [{ id: 'h', ini: 'HG' }, { id: 'j', ini: 'JM' }];
  const r = parseSheet(sheet, people, 2026, { fillRegular: true });
  assert.equal(r.month, 9);
  assert.deepEqual(r.unmatched, ['ZZ']);
  assert.deepEqual(r.unknown, { K: 1 });
  const got = Object.fromEntries(r.entries.map(e => [`${e.user_id}${e.day.slice(8)}`, e.code]));
  assert.deepEqual(got, { h01: 'R', j01: 'T', h02: 'T', j02: 'LDF', j03: 'C1', j05: 'Frei' }); // 3.10. Feiertag, 4.10. Sonntag
});

test('Kalenderdatei: 24-h-Dienst 08:00 bis 08:00, Tagdienst ganztägig', () => {
  const ics = buildCalendar('Test', [shiftItem('u', '2026-10-31', 'C3'), shiftItem('u', '2026-12-31', 'T'), apptItem({ id: 1, day: '2026-11-02', t_from: '14:00:00', t_to: '15:00:00', title: null })]);
  assert.match(ics, /DTSTART;TZID=Europe\/Berlin:20261031T080000\r\nDTEND;TZID=Europe\/Berlin:20261101T080000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(ics, /SUMMARY:Privat/);
  assert.ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75));
});

test('Teammitglied: nur die eigene Spalte wird übernommen', () => {
  const sheet = { name: 'Oktober', rows: [['', '', 'HG', 'JM'], ['1', 'Do', 'R', 'U'], ['2', 'Fr', 'C3', '']] };
  const r = parseSheet(sheet, [{ id: 'j', ini: 'JM' }], 2026, { fillRegular: false });
  assert.deepEqual(r.entries, [{ user_id: 'j', day: '2026-10-01', code: 'U' }]);
});
