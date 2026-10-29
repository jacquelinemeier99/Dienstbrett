// Dienstarten – gemeinsam genutzt von App und Kalender-Abo

export const GROUPS = {
  buero:  { label: 'Im Büro', color: '--g-buero' },
  h24:    { label: '24-h-Dienst', color: '--g-h24' },
  gast:   { label: 'Praktikum', color: '--g-gast' },
  ho:     { label: 'Homeoffice', color: '--g-ho' },
  wache:  { label: 'Andere Wache', color: '--g-wache' },
  bv:     { label: 'Besondere Verpflichtung', color: '--g-bv' },
  urlaub: { label: 'Urlaub', color: '--g-urlaub' },
  frei:   { label: 'Frei', color: '--g-frei' },
  other:  { label: 'Sonstiges', color: '--g-other' },
};

export const CODES = {
  'T':     { label: 'Tagdienst', grp: 'buero' },
  'T½':    { label: 'Halber Tag', grp: 'buero' },
  'P-Spr': { label: 'Pressesprecher', grp: 'buero' },
  'HO':    { label: 'Homeoffice', grp: 'ho' },
  'BV':    { label: 'Besondere Verpflichtung (Veranstaltung)', grp: 'bv' },
  'C1':    { label: 'C1 · andere Wache', grp: 'wache' },
  'C2':    { label: 'C2 · andere Wache', grp: 'wache' },
  'C3':    { label: '24-h-Dienst C3', grp: 'h24' },
  'LDF':   { label: '24-h-Dienst LDF', grp: 'h24' },
  'B':     { label: '24-h-Dienst B', grp: 'h24' },
  'A':     { label: '24-h-Dienst A', grp: 'h24' },
  'R':     { label: 'Frei (R)', grp: 'frei' },
  'Frei':  { label: 'Frei', grp: 'frei' },
  'U':     { label: 'Urlaub', grp: 'urlaub' },
};
export const ALL_CODES = Object.keys(CODES);

// Schreibweisen aus der Team-Excel
export const ALIAS = { '#': 'Frei', 'LD': 'LDF', '1/2T': 'T½', 'T1/2': 'T½', '½T': 'T½', 'PSPR': 'P-Spr', 'P-SPR': 'P-Spr', 'FREI': 'Frei' };

export const QUICK = ['T', 'T½', 'P-Spr', 'HO', 'BV'];
export const H24 = ['C1', 'C2', 'C3', 'LDF', 'B', 'A'];
export const OFF = ['R', 'Frei', 'U'];
export const REGULAR = ['T', 'T½'];          // Regeldienst: im Team- und Outlook-Kalender ausgeblendet

export const normalize = (raw) => {
  const c = String(raw ?? '').trim().replace(/^-+|-+$/g, '');
  if (!c) return '';
  if (CODES[c]) return c;
  return ALIAS[c] || ALIAS[c.toUpperCase()] || null;   // null = unbekanntes Kürzel
};
export const info = (c) => CODES[c] || { label: c, grp: 'other' };
export const is24 = (c) => ['h24', 'wache'].includes(info(c).grp);
