// Anmeldung über den Link in der E-Mail statt über den Code
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:5173/'); await p.fill('#l-mail', 'link@test.de');
  const since = new Date(Date.now() - 1000); await p.click('#mailform button[type=submit]'); await p.waitForSelector('#l-code');
  let link;
  for (let i = 0; i < 40 && !link; i++) {
    const r = await (await fetch('http://127.0.0.1:54324/api/v1/search?query=to:link@test.de')).json();
    const m = (r.messages || []).find(x => new Date(x.Created) > since);
    if (m) { const full = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${m.ID}`)).json(); link = /href="([^"]+)"/.exec(full.HTML)[1].replace(/&amp;/g, '&'); }
    else await new Promise(r => setTimeout(r, 500));
  }
  const p2 = await b.newPage(); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(link); await p2.waitForTimeout(2500);
  const txt = await p2.textContent('#app');
  console.log(txt.includes('Hallo Link') ? 'OK   Anmeldung per Link' : 'FAIL Anmeldung per Link: ' + txt.slice(0, 120), '| Adresse:', p2.url(), '| Fehler:', errs);
  await b.close();
})();
