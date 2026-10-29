// Datenzugriff: Supabase-Anbindung, lokaler Zwischenspeicher und Live-Aktualisierung
import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(URL_ && KEY);
export const sb = configured ? createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
export const feedBase = configured ? `${URL_}/functions/v1/feed` : '';

const pad = (n) => String(n).padStart(2, '0');
export const store = {
  me: null, profiles: [], shifts: new Map(), events: new Map(), bookings: new Map(), appts: new Map(),
  feed: null, invites: [], loaded: new Set(), loading: new Set(),
};
const sk = (uid, day) => `${uid}|${day}`;
export const shiftOf = (uid, day) => store.shifts.get(sk(uid, day)) || '';

let onChange = () => {};
export const setOnChange = (fn) => { onChange = fn; };

async function all(query) {                    // umgeht das 1000-Zeilen-Limit
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function boot() {
  const { data: me, error } = await sb.rpc('claim_invite');
  if (error) throw error;
  if (!me || !me.id) return null;
  store.me = me;
  await Promise.all([loadProfiles(), loadFeed(), me.role === 'admin' ? loadInvites() : null]);
  subscribe();
  return me;
}

export async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('id,name,ini,role,guest_from,guest_until,sort').order('sort').order('name');
  if (error) throw error;
  store.profiles = data;
  const me = data.find(p => p.id === store.me.id); if (me) store.me = me;
}
export async function loadFeed() {
  const { data } = await sb.from('feed_settings').select('*').eq('user_id', store.me.id).maybeSingle();
  store.feed = data;
}
export async function loadInvites() {
  const { data } = await sb.from('invites').select('*').order('created_at');
  store.invites = data || [];
}

/** Lädt Monate (YYYY-MM) nach, die noch nicht im Speicher sind */
export async function ensureMonths(months) {
  const need = [...new Set(months)].filter(m => !store.loaded.has(m) && !store.loading.has(m));
  if (!need.length) return false;
  need.forEach(m => store.loading.add(m));
  try {
    await Promise.all(need.map(async (m) => {
      const [y, mo] = m.split('-').map(Number);
      const from = `${m}-01`, to = `${m}-${pad(new Date(y, mo, 0).getDate())}`;
      const [sh, ev, bo, ap] = await Promise.all([
        all(() => sb.from('shifts').select('user_id,day,code').gte('day', from).lte('day', to)),
        all(() => sb.from('events').select('*').gte('day', from).lte('day', to)),
        all(() => sb.from('bookings').select('*').gte('day', from).lte('day', to)),
        all(() => sb.from('appts').select('*').gte('day', from).lte('day', to)),
      ]);
      sh.forEach(s => store.shifts.set(sk(s.user_id, s.day), s.code));
      ev.forEach(e => store.events.set(e.id, e));
      bo.forEach(b => store.bookings.set(b.id, b));
      ap.forEach(a => store.appts.set(a.id, a));
      store.loaded.add(m);
    }));
  } finally { need.forEach(m => store.loading.delete(m)); }
  return true;
}

function subscribe() {
  sb.channel('dienstbrett')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, ({ eventType, new: n, old: o }) => {
      if (eventType === 'DELETE') store.shifts.delete(sk(o.user_id, o.day)); else store.shifts.set(sk(n.user_id, n.day), n.code);
      onChange();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, ({ eventType, new: n, old: o }) => {
      if (eventType === 'DELETE') store.events.delete(o.id); else store.events.set(n.id, n);
      onChange();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, ({ eventType, new: n, old: o }) => {
      if (eventType === 'DELETE') store.bookings.delete(o.id); else store.bookings.set(n.id, n);
      onChange();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async () => { await loadProfiles(); onChange(); })
    .subscribe();
}

// ---------- Schreiben ----------
const fail = (error) => { if (error) throw error; };

export async function setShift(uid, day, code) {
  const prev = shiftOf(uid, day);
  if (code) store.shifts.set(sk(uid, day), code); else store.shifts.delete(sk(uid, day));
  onChange();
  const { error } = code
    ? await sb.from('shifts').upsert({ user_id: uid, day, code, updated_at: new Date().toISOString() })
    : await sb.from('shifts').delete().eq('user_id', uid).eq('day', day);
  if (error) { if (prev) store.shifts.set(sk(uid, day), prev); else store.shifts.delete(sk(uid, day)); onChange(); throw error; }
}
export async function upsertShifts(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(r => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await sb.from('shifts').upsert(chunk); fail(error);
    chunk.forEach(r => store.shifts.set(sk(r.user_id, r.day), r.code));
  }
  onChange();
}
export async function upsertPending(rows) {        // Dienste für Kürzel vormerken (nur Admins)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('pending_shifts').upsert(rows.slice(i, i + 500)); fail(error);
  }
}
export async function paintShifts(uid, changes) {   // changes: Map(day -> code | '')
  const set = [...changes].filter(([, c]) => c).map(([day, code]) => ({ user_id: uid, day, code, updated_at: new Date().toISOString() }));
  const del = [...changes].filter(([, c]) => !c).map(([day]) => day);
  const prev = new Map([...changes.keys()].map(d => [d, shiftOf(uid, d)]));
  changes.forEach((c, d) => c ? store.shifts.set(sk(uid, d), c) : store.shifts.delete(sk(uid, d)));
  onChange();
  try {
    if (set.length) { const { error } = await sb.from('shifts').upsert(set); fail(error); }
    if (del.length) { const { error } = await sb.from('shifts').delete().eq('user_id', uid).in('day', del); fail(error); }
  } catch (e) {
    prev.forEach((c, d) => c ? store.shifts.set(sk(uid, d), c) : store.shifts.delete(sk(uid, d))); onChange(); throw e;
  }
}
export async function addEvent(day, at, title) {
  const { data, error } = await sb.from('events').insert({ day, at: at || null, title, created_by: store.me.id }).select().single();
  fail(error); store.events.set(data.id, data); onChange();
}
export async function deleteEvent(id) {
  const { error } = await sb.from('events').delete().eq('id', id); fail(error); store.events.delete(id); onChange();
}
export async function addBooking(b) {
  const { data, error } = await sb.from('bookings').insert({ ...b, user_id: store.me.id }).select().single();
  fail(error); store.bookings.set(data.id, data); onChange();
}
export async function deleteBooking(id) {
  const { error } = await sb.from('bookings').delete().eq('id', id); fail(error); store.bookings.delete(id); onChange();
}
export async function addAppt(a) {
  const { data, error } = await sb.from('appts').insert({ ...a, user_id: store.me.id }).select().single();
  fail(error); store.appts.set(data.id, data); onChange();
}
export async function deleteAppt(id) {
  const { error } = await sb.from('appts').delete().eq('id', id); fail(error); store.appts.delete(id); onChange();
}
export async function updateFeed(patch) {
  const { data, error } = await sb.from('feed_settings').update(patch).eq('user_id', store.me.id).select().single();
  fail(error); store.feed = data; onChange();
}
export async function resetFeedToken() {
  const { error } = await sb.rpc('reset_feed_token'); fail(error); await loadFeed(); onChange();
}
// Admin
export async function invite(row) {
  const { error } = await sb.from('invites').insert(row); fail(error); await loadInvites(); onChange();
}
export async function deleteInvite(email) {
  const { error } = await sb.from('invites').delete().eq('email', email); fail(error); await loadInvites(); onChange();
}
export async function updateProfile(id, patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', id); fail(error); await loadProfiles(); onChange();
}
export async function removeMember(id) {
  const { error } = await sb.rpc('remove_member', { uid: id }); fail(error); await Promise.all([loadProfiles(), loadInvites()]); onChange();
}
