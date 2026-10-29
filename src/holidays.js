// Feiertage: bundesweit plus Nordrhein-Westfalen (Fronleichnam, Allerheiligen).
const pad = (n) => String(n).padStart(2, '0');
const k = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function easter(y) {                       // Gauß'sche Osterformel (Gregorianisch)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), kk = c % 4, l = (32 + 2 * e + 2 * i - h - kk) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const cache = {};
function forYear(y) {
  if (cache[y]) return cache[y];
  const e = easter(y), off = (n) => k(new Date(y, e.getMonth(), e.getDate() + n));
  return (cache[y] = {
    [`${y}-01-01`]: 'Neujahr',
    [off(-2)]: 'Karfreitag',
    [off(1)]: 'Ostermontag',
    [`${y}-05-01`]: 'Tag der Arbeit',
    [off(39)]: 'Christi Himmelfahrt',
    [off(50)]: 'Pfingstmontag',
    [`${y}-10-03`]: 'Tag der Dt. Einheit',
    [`${y}-12-25`]: '1. Weihnachtstag',
    [`${y}-12-26`]: '2. Weihnachtstag',
    [off(60)]: 'Fronleichnam',                     // NRW
    [`${y}-11-01`]: 'Allerheiligen',              // NRW
  });
}
export const holidayName = (day) => forYear(Number(day.slice(0, 4)))[day] || '';
