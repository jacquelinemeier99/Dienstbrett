// Ende-zu-Ende-Test gegen eine lokale Supabase-Umgebung
const { chromium } = require('playwright');
const APP = 'http://localhost:5173/', MAIL = 'http://127.0.0.1:54324';
const OUT = process.env.SHOTS || '.';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function codeFor(email, since) {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json();
    const m = (r.messages || []).find(x => new Date(x.Created) > since);
    if (m) { const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json(); return /(\d{6})/.exec(full.Text || full.HTML)[1]; }
    await sleep(500);
  }
  throw new Error('kein Code für ' + email);
}
async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => results.push('PAGEERROR ' + email + ': ' + e.message));
  await p.goto(APP);
  await p.fill('#l-mail', email);
  const since = new Date(Date.now() - 1000);
  await p.click('#mailform button[type=submit]');
  await p.waitForSelector('#l-code');
  await p.fill('#l-code', await codeFor(email, since));
  await p.click('#codeform button[type=submit]');
  await p.waitForTimeout(1500);
  return p;
}
const closeSheet = async p => { if (await p.$('#scrim')) await p.keyboard.press('Escape'); };

(async () => {
  const b = await chromium.launch();
  // 1) Jacqueline (Admin)
  const j = await login(b, 'jacqueline@test.de');
  check('Datenschutzhinweis beim ersten Login', !!(await j.$('text=Datenschutzhinweis')));
  await closeSheet(j);
  check('Begrüßung', (await j.textContent('.hello')).includes('Jacqueline'));
  await j.click('[data-set="C3"]'); await j.waitForTimeout(600);
  check('Dienst C3 gesetzt', (await j.textContent('.mynow strong')).includes('C3'));
  await j.click('[data-act=add-ev]'); await j.fill('#e-title', 'Abteilungsbesprechung'); await j.fill('#e-time', '10:00');
  await j.click('#evform button[type=submit]'); await j.waitForTimeout(600);
  check('Teamtermin angelegt', (await j.textContent('#app')).includes('Abteilungsbesprechung'));
  await j.screenshot({ path: `${OUT}/e2e-heute.png`, fullPage: true });
  await j.click('[data-tab=autos]'); await j.click('[data-act=book]');
  await j.fill('#b-from', '09:00'); await j.fill('#b-to', '12:00'); await j.click('#bookform button[type=submit]'); await j.waitForTimeout(800);
  check('Auto gebucht', (await j.textContent('.car')).includes('Ich'));
  await j.screenshot({ path: `${OUT}/e2e-autos.png` });
  await j.click('[data-tab=plan]'); await j.waitForTimeout(400);
  const today = new Date(); const tk = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  await j.click(`[data-edit="${tk}"]`);
  await j.fill('#a-from', '14:00'); await j.fill('#a-to', '15:00'); await j.fill('#a-title', 'Zahnarzt');
  await j.click('#apptform button[type=submit]'); await j.waitForTimeout(800);
  check('Eigener Termin gespeichert', (await j.textContent('.sheet')).includes('Zahnarzt'));
  await closeSheet(j);
  // Excel-Import
  await j.click('[data-tab=ich]'); await j.waitForTimeout(300);
  check('Admin-Bereich sichtbar', !!(await j.$('text=Team verwalten')));
  await j.setInputFiles('#upload', 'tests/team-test.xlsx'); await j.waitForTimeout(800);
  const imp = await j.textContent('#importres');
  check('Excel gelesen', imp.includes('November') && imp.includes('JM') && imp.includes('XY'), imp.replace(/\s+/g, ' ').slice(0, 160));
  await j.screenshot({ path: `${OUT}/e2e-import.png`, fullPage: true });
  await j.click('#imp-go'); await j.waitForTimeout(1200);
  const token = await j.evaluate(() => document.querySelector('[data-act=copy-feed]') && true);
  check('Kalender-Abo-Bereich', token);
  await j.screenshot({ path: `${OUT}/e2e-ich.png`, fullPage: true });

  // 2) Anna (Team)
  const a = await login(b, 'anna@test.de'); await closeSheet(a);
  check('Anna sieht Jacquelines C3', (await a.textContent('#app')).includes('C3'));
  check('Anna sieht Teamtermin', (await a.textContent('#app')).includes('Abteilungsbesprechung'));
  check('Anna sieht keinen Zahnarzt', !(await a.textContent('#app')).includes('Zahnarzt'));
  // Direkter Datenbankzugriff mit Annas Anmeldung: Jacquelines Termine dürfen nicht lesbar sein
  const env = Object.fromEntries(require('fs').readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map(l => l.split(/=(.*)/s).slice(0, 2)));
  const annaToken = await a.evaluate(() => JSON.parse(localStorage[Object.keys(localStorage).find(x => x.includes('auth-token'))]).access_token);
  const rows = await (await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/appts?select=*`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${annaToken}` } })).json();
  check('Datenbank gibt Anna keine fremden Termine', Array.isArray(rows) && rows.length === 0, JSON.stringify(rows).slice(0, 80));
  const anon = await (await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/shifts?select=*`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY } })).json();
  check('Ohne Anmeldung keine Dienste', !Array.isArray(anon) || anon.length === 0);
  check('Anna hat kein Admin-Menü', !(await a.$('[data-tab=ich]').then(async () => { await a.click('[data-tab=ich]'); return a.$('text=Team verwalten'); })));
  await a.click('[data-tab=autos]'); await a.click('[data-act=book]');
  await a.fill('#b-from', '10:00'); await a.fill('#b-to', '11:00'); await a.click('#bookform button[type=submit]'); await a.waitForTimeout(800);
  check('Doppelbuchung verhindert', (await a.textContent('#b-err')).includes('schon von Jacqueline reserviert'));
  await closeSheet(a);
  await a.click('[data-tab=team]'); await a.waitForTimeout(800);
  await a.screenshot({ path: `${OUT}/e2e-team.png`, fullPage: true });

  // 3) Paul (Praktikum)
  const pl = await login(b, 'paul@test.de'); await closeSheet(pl);
  check('Gast: kein Teamtermin-Button', !(await pl.$('[data-act=add-ev]')));
  await pl.click('[data-tab=autos]');
  check('Gast: kein Reservieren', !(await pl.$('[data-act=book]')));

  // 4) Fremde Person
  const x = await b.newContext().then(c => c.newPage());
  await x.goto(APP); await x.fill('#l-mail', 'fremd@test.de'); const s2 = new Date(Date.now() - 1000); await x.click('#mailform button[type=submit]');
  await x.waitForSelector('#l-code'); await x.fill('#l-code', await codeFor('fremd@test.de', s2)); await x.click('#codeform button[type=submit]'); await x.waitForTimeout(1500);
  check('Fremde Person: kein Zugang', (await x.textContent('#app')).includes('Kein Zugang'));

  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(1); });
