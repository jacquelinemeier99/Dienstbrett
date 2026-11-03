-- Teamtermine hängen am Datum, nicht an Personen:
-- Kürzel (z. B. WM, VfL), Beschreibung und optional ein Zeitraum über mehrere Tage.

alter table public.events add column if not exists short   text;
alter table public.events add column if not exists info    text check (length(info) <= 1000);
alter table public.events add column if not exists day_end date;

update public.events set short = case when length(title) <= 6 then title else left(title, 4) || '.' end
  where short is null;
alter table public.events alter column short set not null;
alter table public.events add constraint events_short_len check (length(short) between 1 and 8);
alter table public.events add constraint events_range check (day_end is null or day_end >= day);

-- Alle im Team dürfen Teamtermine ändern und löschen (nicht nur, wer sie angelegt hat)
drop policy if exists events_change on public.events;
drop policy if exists events_delete on public.events;
create policy events_change on public.events for update using (public.is_staff()) with check (public.is_staff());
create policy events_delete on public.events for delete using (public.is_staff());

-- Löschfrist richtet sich nach dem letzten Tag des Termins
create or replace function public.purge_old() returns void
language sql security definer set search_path = public as $$
  delete from shifts   where day < current_date - interval '13 months';
  delete from pending_shifts where day < current_date - interval '13 months';
  delete from events   where coalesce(day_end, day) < current_date - interval '3 months';
  delete from bookings where day < current_date - interval '3 months';
  delete from appts    where day < current_date - interval '1 month';
  delete from profiles where role = 'guest' and guest_until < current_date - interval '30 days';
  delete from invites  where role = 'guest' and guest_until < current_date - interval '30 days';
$$;
