-- Dienste für Kürzel vormerken, auch wenn die Person sich noch nicht angemeldet hat.
-- Beim ersten Login werden die vorgemerkten Dienste automatisch übernommen.

create table public.pending_shifts (
  ini   text not null,
  day   date not null,
  code  text not null check (code in
          ('T','T½','P-Spr','HO','BV','C1','C2','C3','LDF','B','A','R','Frei','U')),
  primary key (ini, day)
);
alter table public.pending_shifts enable row level security;
create policy pending_admin on public.pending_shifts for all
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.pending_shifts to authenticated;
grant all on public.pending_shifts to service_role;

-- Vorgemerkte Dienste eines Kürzels an das passende Profil übergeben (intern)
create or replace function public.apply_pending_for(p_ini text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into shifts (user_id, day, code)
  select p.id, ps.day, ps.code from pending_shifts ps
  join profiles p on upper(p.ini) = upper(ps.ini)
  where upper(ps.ini) = upper(p_ini)
  on conflict (user_id, day) do update set code = excluded.code, updated_at = now();
  get diagnostics n = row_count;
  delete from pending_shifts ps where upper(ps.ini) = upper(p_ini)
    and exists (select 1 from profiles p where upper(p.ini) = upper(p_ini));
  return n;
end $$;
revoke execute on function public.apply_pending_for(text) from public, anon, authenticated;

-- Für Admins: alles Vorgemerkte übergeben, dessen Person schon angemeldet ist
create or replace function public.apply_pending() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  for r in select distinct ini from pending_shifts loop n := n + public.apply_pending_for(r.ini); end loop;
  return n;
end $$;
revoke execute on function public.apply_pending() from public, anon;
grant execute on function public.apply_pending() to authenticated;

-- Erster Login: Einladung → Profil, danach vorgemerkte Dienste übernehmen
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
  perform public.apply_pending_for(inv.ini);
  return prof;
end $$;

-- Löschfristen auch für Vorgemerktes
create or replace function public.purge_old() returns void
language sql security definer set search_path = public as $$
  delete from shifts   where day < current_date - interval '13 months';
  delete from pending_shifts where day < current_date - interval '13 months';
  delete from events   where day < current_date - interval '3 months';
  delete from bookings where day < current_date - interval '3 months';
  delete from appts    where day < current_date - interval '1 month';
  delete from profiles where role = 'guest' and guest_until < current_date - interval '30 days';
  delete from invites  where role = 'guest' and guest_until < current_date - interval '30 days';
$$;
