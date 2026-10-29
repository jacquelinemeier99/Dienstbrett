// Liest .xlsx-Dateien direkt im Browser – ohne Fremdbibliothek, ohne Upload.
// Ergebnis: [{ name: 'Oktober', rows: [['', 'HG', 'FK', …], ['1 Do', 'R', '', …], …] }]

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

async function unzip(buf) {
  const v = new DataView(buf), files = {};
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Das ist keine gültige Excel-Datei (.xlsx).');
  let p = u32(v, eocd + 16);
  const count = u16(v, eocd + 10);
  for (let n = 0; n < count; n++) {
    if (u32(v, p) !== 0x02014b50) break;
    const method = u16(v, p + 10), csize = u32(v, p + 20);
    const nlen = u16(v, p + 28), elen = u16(v, p + 30), clen = u16(v, p + 32), lho = u32(v, p + 42);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
    const start = lho + 30 + u16(v, lho + 26) + u16(v, lho + 28);
    files[name] = { method, data: new Uint8Array(buf, start, csize) };
    p += 46 + nlen + elen + clen;
  }
  return async (name) => {
    const f = files[name]; if (!f) return null;
    if (f.method === 0) return new TextDecoder().decode(f.data);
    const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  };
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, tag) => [...el.getElementsByTagName(tag)];
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export async function readXlsx(arrayBuffer) {
  const get = await unzip(arrayBuffer);
  const wb = xml(await get('xl/workbook.xml') || '');
  const rels = xml(await get('xl/_rels/workbook.xml.rels') || '<r/>');
  const target = {};
  for (const r of kids(rels, 'Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
  const ssXml = await get('xl/sharedStrings.xml');
  const shared = ssXml ? kids(xml(ssXml), 'si').map(si => kids(si, 't').map(t => t.textContent).join('')) : [];

  const sheets = [];
  for (const s of kids(wb, 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let path = target[rid] || ''; path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const sx = await get(path); if (!sx) continue;
    const rows = [];
    for (const row of kids(xml(sx), 'row')) {
      const r = Number(row.getAttribute('r')) - 1, cells = [];
      for (const c of kids(row, 'c')) {
        const t = c.getAttribute('t'), vEl = kids(c, 'v')[0];
        let val = '';
        if (t === 's') val = shared[Number(vEl?.textContent)] ?? '';
        else if (t === 'inlineStr') val = kids(c, 't').map(x => x.textContent).join('');
        else val = vEl?.textContent ?? '';
        cells[colIndex(c.getAttribute('r'))] = String(val).trim();
      }
      rows[r] = Array.from(cells, x => x ?? '');
    }
    sheets.push({ name: s.getAttribute('name'), rows: Array.from(rows, x => x ?? []) });
  }
  return sheets;
}
