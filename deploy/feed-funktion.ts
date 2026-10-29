// Kalender-Abo – fertige Einzeldatei zum Einfügen im Supabase-Dashboard (Edge Functions → Deploy a new function → Via Editor, Name: feed).
// Erzeugt aus supabase/functions/feed/index.ts. Nicht von Hand ändern.
// supabase/functions/_shared/codes.js
var CODES = {
  "T": { label: "Tagdienst", grp: "buero" },
  "T\xBD": { label: "Halber Tag", grp: "buero" },
  "P-Spr": { label: "Pressesprecher", grp: "buero" },
  "HO": { label: "Homeoffice", grp: "ho" },
  "BV": { label: "Besondere Verpflichtung (Veranstaltung)", grp: "bv" },
  "C1": { label: "C1 \xB7 andere Wache", grp: "wache" },
  "C2": { label: "C2 \xB7 andere Wache", grp: "wache" },
  "C3": { label: "24-h-Dienst C3", grp: "h24" },
  "LDF": { label: "24-h-Dienst LDF", grp: "h24" },
  "B": { label: "24-h-Dienst B", grp: "h24" },
  "A": { label: "24-h-Dienst A", grp: "h24" },
  "R": { label: "Frei (R)", grp: "frei" },
  "Frei": { label: "Frei", grp: "frei" },
  "U": { label: "Urlaub", grp: "urlaub" }
};
var ALL_CODES = Object.keys(CODES);
var info = (c) => CODES[c] || { label: c, grp: "other" };
var is24 = (c) => ["h24", "wache"].includes(info(c).grp);

// supabase/functions/_shared/ics.js
var VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:MESZ",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:MEZ",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE"
];
var esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
var d8 = (day) => day.replaceAll("-", "");
var t6 = (time) => time.slice(0, 5).replace(":", "") + "00";
var nextDay = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + 1));
  return x.toISOString().slice(0, 10);
};
var fold = (line) => {
  const out = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 74) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
};
function buildCalendar(name, items, stamp = /* @__PURE__ */ new Date()) {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const L = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dienstbrett//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE
  ];
  for (const it of items) {
    L.push("BEGIN:VEVENT", `UID:${it.uid}`, `DTSTAMP:${dtstamp}`);
    if (it.from) {
      L.push(
        `DTSTART;TZID=Europe/Berlin:${d8(it.day)}T${t6(it.from)}`,
        `DTEND;TZID=Europe/Berlin:${d8(it.toNextDay ? nextDay(it.day) : it.day)}T${t6(it.to)}`
      );
    } else {
      L.push(`DTSTART;VALUE=DATE:${d8(it.day)}`, `DTEND;VALUE=DATE:${d8(nextDay(it.day))}`);
    }
    L.push(`TRANSP:${it.busy ? "OPAQUE" : "TRANSPARENT"}`, `SUMMARY:${esc(it.title)}`, "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
function shiftItem(userKey, day, code) {
  const g = info(code).grp;
  const title = g === "h24" ? `${code} \u2013 24-h-Dienst` : g === "wache" ? `${code} \u2013 24-h-Dienst (andere Wache)` : code === "Frei" ? "Frei" : `${code} \u2013 ${info(code).label.replace(/ \(.*\)$/, "")}`;
  const base = { uid: `dienst-${day}-${userKey}@dienstbrett`, day, title };
  return is24(code) ? { ...base, from: "08:00", to: "08:00", toNextDay: true, busy: true } : base;
}
function eventItem(e) {
  return {
    uid: `team-${e.id}@dienstbrett`,
    day: e.day,
    title: e.title,
    ...e.at ? { from: e.at, to: addHour(e.at), busy: true } : {}
  };
}
function apptItem(a) {
  return { uid: `termin-${a.id}@dienstbrett`, day: a.day, title: a.title || "Privat", from: a.t_from, to: a.t_to, busy: true };
}
function addHour(t) {
  const [h, m] = t.split(":").map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// supabase/functions/feed/index.ts
var BASE = Deno.env.get("SUPABASE_URL") + "/rest/v1/";
var KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
async function q(path) {
  const r = await fetch(BASE + path, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`DB ${r.status}`);
  return await r.json();
}
var inList = (xs) => `(${xs.map((x) => `"${x.replace(/"/g, "")}"`).join(",")})`;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var iso = (d) => d.toISOString().slice(0, 10);
Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID.test(token)) return new Response("Not found", { status: 404 });
  const [fs] = await q(`feed_settings?select=*&token=eq.${token}`);
  if (!fs) return new Response("Not found", { status: 404 });
  const [prof] = await q(`profiles?select=id,role,guest_until&id=eq.${fs.user_id}`);
  const today = /* @__PURE__ */ new Date();
  if (!prof || prof.role === "guest" && prof.guest_until < iso(today)) return new Response("Not found", { status: 404 });
  const from = iso(new Date(today.getTime() - 60 * 864e5));
  const to = iso(new Date(today.getTime() + 400 * 864e5));
  const userKey = String(fs.user_id).slice(0, 8);
  const items = [];
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
  return new Response(buildCalendar("Meine Dienste", items), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="dienste.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex"
    }
  });
});
