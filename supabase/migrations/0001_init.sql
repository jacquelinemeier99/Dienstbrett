-- Dienstbrett: Datenbank-Schema
-- Grundsatz: Nur eingeladene Personen haben Zugriff. Dienste, Teamtermine und
-- Auto-Buchungen sieht das ganze Team. Eigene Termine sieht nur die Person selbst.
-- Krankmeldungen o. Ä. werden bewusst nicht erfasst (nur erlaubte Dienstkürzel).

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Einladungen (nur Admins). Wer hier nicht steht, bekommt kein Profil.
-- ---------------------------------------------------------------------------
create table public.invites (
  email        text primary key check (email = lower(email)),
  name         text not null check (length(name) between 1 and 80),
  ini          text not null check (length(ini) between 1 and 4),
  role         text not null default 'member' check (role in ('admin','member','guest')),
  guest_until  date,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  check (role <> 'guest' or guest_until is not null)
);

-- ---------------------------------------------------------------------------
-- Profile: ohne E-Mail-Adresse, damit das Team nur Name und Kürzel sieht.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  name         text not null,
  ini          text not null,
  role         text not null check (role in ('admin','member','guest')),
  guest_from   date not null default current_date,
  guest_until  date,
  sort         int  not null default 100,
  created_at   timestamptz not null default now()
);

-- Hilfsfunktionen für die Zugriffsregeln
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles
  where id = auth.uid() and (role <> 'guest' or guest_until >= current_date)
$$;
create or replace function public.is_member() returns boolean
language sql stable as $$ select public.my_role() is not null $$;
create or replace function public.is_staff() returns boolean
language sql stable as $$ select public.my_role() in ('admin','member') $$;
create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.my_role() = 'admin' $$;

-- Beim ersten Login: Einladung in ein Profil umwandeln (falls vorhanden).
create or replace function public.claim_invite() returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  inv invites;
  prof profiles;
begin
  select * into prof from profiles where id = auth.uid();
  if found then return prof; end if;
  select * into inv from invites where email = lower(auth.jwt() ->> 'email')
    and (role <> 'guest' or guest_until >= current_date);
  if not found then return null; end if;
  insert into profiles (id, name, ini, role, guest_until)
  values (auth.uid(), inv.name, inv.ini, inv.role, inv.guest_until)
  returning * into prof;
  insert into feed_settings (user_id) values (auth.uid()) on conflict do nothing;
  update invites set claimed_at = now() where email = inv.email;
  return prof;
end $$;

-- ---------------------------------------------------------------------------
-- Dienste: ein Kürzel pro Person und Tag
-- ---------------------------------------------------------------------------
create table public.shifts (
  user_id    uuid not null references public.profiles on delete cascade,
  day        date not null,
  code       text not null check (code in
               ('T','T½','P-Spr','HO','BV','C1','C2','C3','LDF','B','A','R','Frei','U')),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- Teamtermine (für alle sichtbar)
-- ---------------------------------------------------------------------------
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  day        date not null,
  at         time,
  title      text not null check (length(title) between 1 and 120),
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Auto-Reservierungen: Überschneidungen verhindert die Datenbank selbst
-- ---------------------------------------------------------------------------
create table public.bookings (
  id         uuid primary key default gen_random_uuid(),
  car        smallint not null check (car in (0,1)),
  day        date not null,
  t_from     time not null,
  t_to       time not null,
  user_id    uuid not null references public.profiles on delete cascade default auth.uid(),
  ziel       text check (length(ziel) <= 120),
  created_at timestamptz not null default now(),
  check (t_to > t_from),
  constraint no_double_booking exclude using gist
    (car with =, tsrange(day + t_from, day + t_to) with &&)
);

-- ---------------------------------------------------------------------------
-- Eigene Termine: ausschließlich für die Person selbst
-- ---------------------------------------------------------------------------
create table public.appts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade default auth.uid(),
  day        date not null,
  t_from     time not null,
  t_to       time not null,
  title      text check (length(title) <= 120),       -- leer = "Privat"
  in_feed    boolean not null default true,
  check (t_to > t_from)
);

-- ---------------------------------------------------------------------------
-- Persönliches Kalender-Abo
-- ---------------------------------------------------------------------------
create table public.feed_settings (
  user_id        uuid primary key references public.profiles on delete cascade,
  token          uuid not null unique default gen_random_uuid(),
  codes          text[] not null default
                   array['T','T½','P-Spr','HO','BV','C1','C2','C3','LDF','B','A','R','Frei','U'],
  include_team   boolean not null default true,
  include_appts  boolean not null default true
);

create or replace function public.reset_feed_token() returns uuid
language sql security definer set search_path = public as $$
  update feed_settings set token = gen_random_uuid()
  where user_id = auth.uid() returning token
$$;

-- Person entfernen (nur Admins): löscht Profil samt aller Daten und die Einladung,
-- damit ein erneuter Login keinen Zugang mehr gibt.
create or replace function public.remove_member(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() or uid = auth.uid() then raise exception 'not allowed'; end if;
  delete from invites where email = (select lower(email) from auth.users where id = uid);
  delete from profiles where id = uid;
end $$;

-- ---------------------------------------------------------------------------
-- Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------------------
alter table public.invites       enable row level security;
alter table public.profiles      enable row level security;
alter table public.shifts        enable row level security;
alter table public.events        enable row level security;
alter table public.bookings      enable row level security;
alter table public.appts         enable row level security;
alter table public.feed_settings enable row level security;

create policy invites_admin on public.invites for all
  using (public.is_admin()) with check (public.is_admin());

create policy profiles_read  on public.profiles for select using (public.is_member());
create policy profiles_admin on public.profiles for update using (public.is_admin()) with check (public.is_admin());
create policy profiles_del   on public.profiles for delete using (public.is_admin() and id <> auth.uid());

create policy shifts_read  on public.shifts for select using (public.is_member());
create policy shifts_write on public.shifts for all
  using  (public.is_member() and (user_id = auth.uid() or public.is_admin()))
  with check (public.is_member() and (user_id = auth.uid() or public.is_admin()));

create policy events_read   on public.events for select using (public.is_member());
create policy events_insert on public.events for insert with check (public.is_staff() and created_by = auth.uid());
create policy events_change on public.events for update
  using (public.is_staff() and (created_by = auth.uid() or public.is_admin()));
create policy events_delete on public.events for delete
  using (public.is_staff() and (created_by = auth.uid() or public.is_admin()));

create policy bookings_read   on public.bookings for select using (public.is_member());
create policy bookings_insert on public.bookings for insert with check (public.is_staff() and user_id = auth.uid());
create policy bookings_delete on public.bookings for delete
  using (public.is_staff() and (user_id = auth.uid() or public.is_admin()));

create policy appts_own on public.appts for all
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

create policy feed_own on public.feed_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Anonyme Besucher bekommen gar nichts
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;          -- für das Kalender-Abo
revoke execute on all functions in schema public from anon, public;
grant execute on function public.claim_invite(), public.reset_feed_token(), public.remove_member(uuid),
  public.my_role(), public.is_member(), public.is_staff(), public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Löschfristen: alte Einträge automatisch entfernen
-- ---------------------------------------------------------------------------
create or replace function public.purge_old() returns void
language sql security definer set search_path = public as $$
  delete from shifts   where day < current_date - interval '13 months';
  delete from events   where day < current_date - interval '3 months';
  delete from bookings where day < current_date - interval '3 months';
  delete from appts    where day < current_date - interval '1 month';
  delete from profiles where role = 'guest' and guest_until < current_date - interval '30 days';
  delete from invites  where role = 'guest' and guest_until < current_date - interval '30 days';
$$;

-- Live-Aktualisierung für alle geöffneten Apps
alter publication supabase_realtime add table public.shifts, public.events, public.bookings, public.profiles;
