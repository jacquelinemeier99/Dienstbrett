// Persönliches Kalender-Abo: GET /functions/v1/feed?token=<geheimer Schlüssel>
// Liefert nur die Daten der Person, der der Schlüssel gehört, und nur das, was sie ausgewählt hat.
// Ohne Fremdbibliotheken: direkte Abfragen an die Datenbank-Schnittstelle.
import { buildCalendar, shiftItem, eventItem, apptItem } from '../_shared/ics.js';

const BASE = Deno.env.get('SUPABASE_URL')! + '/rest/v1/';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function q(path: string) {
  const r = await fetch(BASE + path, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`DB ${r.status}`);
  return await r.json();
}
const inList = (xs: string[]) => `(${xs.map(x => `"${x.replace(/"/g, '')}"`).join(',')})`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!UUID.test(token)) return new Response('Not found', { status: 404 });

  const [fs] = await q(`feed_settings?select=*&token=eq.${token}`);
  if (!fs) return new Response('Not found', { status: 404 });

  const [prof] = await q(`profiles?select=id,role,guest_until&id=eq.${fs.user_id}`);
  const today = new Date();
  if (!prof || (prof.role === 'guest' && prof.guest_until < iso(today))) return new Response('Not found', { status: 404 });

  const from = iso(new Date(today.getTime() - 60 * 864e5));
  const to = iso(new Date(today.getTime() + 400 * 864e5));
  const userKey = String(fs.user_id).slice(0, 8);
  const items: unknown[] = [];

  if (fs.codes?.length) {
    const data = await q(`shifts?select=day,code&user_id=eq.${fs.user_id}&day=gte.${from}&day=lte.${to}&code=in.${encodeURIComponent(inList(fs.codes))}&limit=2000`);
    for (const s of data) items.push(shiftItem(userKey, s.day, s.code));
  }
  if (fs.include_team) {
    const data = await q(`events?select=id,day,at,title&day=gte.${from}&day=lte.${to}&limit=2000`);
    for (const e of data) items.push(eventItem(e));
  }
  if (fs.include_appts) {
    const data = await q(`appts?select=id,day,t_from,t_to,title&user_id=eq.${fs.user_id}&in_feed=is.true&day=gte.${from}&day=lte.${to}&limit=2000`);
    for (const a of data) items.push(apptItem(a));
  }

  return new Response(buildCalendar('Meine Dienste', items as never[]), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="dienste.ics"',
      'Cache-Control': 'private, max-age=900',
      'X-Robots-Tag': 'noindex',
    },
  });
});
