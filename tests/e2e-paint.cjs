// Malmodus und Vormerken für noch nicht angemeldete Kürzel
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const APP = 'http://localhost:5173/', MAIL = 'http://127.0.0.1:54324';
const sql = q => execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -X -A -t -c "${q}"`).toString().trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = []; const check = (n, ok, x = '') => res.push(`${ok ? 'OK  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`);
async function codeFor(email, since) {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json();
    const m = (r.messages || []).find(x => new Date(x.Created) > since);
    if (m) { const f = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json(); return /(\d{6})/.exec(f.Text || f.HTML)[1]; }
    await sleep(500);
  }
}
async function login(b, email) {
  const p = await (await b.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  p.on('pageerror', e => res.push('PAGEERROR ' + e.message));
  await p.goto(APP); await p.fill('#l-mail', email); const s = new Date(Date.now() - 1000);
  await p.click('#mailform button[type=submit]'); await p.waitForSelector('#l-code');
  await p.fill('#l-code', await codeFor(email, s)); await p.click('#codeform button[type=submit]'); await p.waitForTimeout(1500);
  if (await p.$('#scrim')) await p.keyboard.press('Escape');
  return p;
}
(async () => {
  const b = await chromium.launch();
  const j = await login(b, 'jacqueline@test.de');
  await j.click('[data-tab=plan]'); await j.click('[data-pmode=on]'); await j.click('[data-paint="C3"]');
  // über drei Tage streichen (13.–15. liegen im Oktober 2026 in einer Zeile)
  const ym = new Date().toISOString().slice(0, 7);
  const box = async d => (await j.$(`[data-edit="${ym}-${d}"]`)).boundingBox();
  const a = await box('13'), c = await box('15');
  await j.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await j.mouse.down();
  await j.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 }); await j.mouse.up(); await j.waitForTimeout(1200);
  const painted = sql(`select string_agg(code, ',' order by day) from shifts where day between '${ym}-13' and '${ym}-15'`);
  check('Malmodus: drei Tage C3', painted === 'C3,C3,C3', painted);
  await j.click('[data-paint=""]'); await j.click(`[data-edit="${ym}-11"]`); await j.waitForTimeout(800);
  check('Malmodus: Leeren', sql(`select count(*) from shifts where day = '${ym}-11'`) === '0');
  await j.click('[data-act=fill-t]'); await j.waitForTimeout(1200);
  check('Alle leeren Werktage T', Number(sql(`select count(*) from shifts where code='T' and to_char(day,'YYYY-MM')='${ym}'`)) > 10);
  await j.screenshot({ path: process.env.SHOTS + '/e2e-malmodus.png', fullPage: true });
  // Vormerken: HG ist eingeladen, aber noch nicht angemeldet
  await j.click('[data-tab=ich]'); await j.waitForTimeout(400);
  await j.setInputFiles('#upload', 'tests/hg-test.xlsx'); await j.waitForTimeout(800);
  const imp = await j.textContent('#importres');
  check('Import zeigt HG als vorgemerkt', imp.includes('HG (vorgemerkt)'), imp.replace(/\s+/g, ' ').slice(0, 120));
  await j.click('#imp-go'); await j.waitForTimeout(1500);
  check('Vorgemerkt in Datenbank', Number(sql(`select count(*) from pending_shifts where ini='HG'`)) > 20);
  const h = await login(b, 'hg@test.de');
  check('HG hat nach Login seine Dienste', sql(`select code from shifts s join profiles p on p.id=s.user_id where p.ini='HG' and day='2026-12-03'`) === 'C3');
  check('Vorgemerktes aufgeräumt', sql(`select count(*) from pending_shifts`) === '0');
  // Teammitglied darf nicht vormerken
  const an = await login(b, 'anna@test.de'); await an.click('[data-tab=ich]'); await an.waitForTimeout(300);
  await an.setInputFiles('#upload', 'tests/hg-test.xlsx'); await an.waitForTimeout(800);
  check('Anna: Import ohne eigene Spalte findet nichts', (await an.textContent('#importres')).includes('keine Kopfzeile'));
  console.log(res.join('\n')); await b.close();
})().catch(e => { console.log(res.join('\n')); console.error(e); process.exit(1); });
