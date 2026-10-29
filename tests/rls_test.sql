\set ON_ERROR_STOP 0
\set QUIET 1
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','jacqueline@example.de'),
 ('00000000-0000-0000-0000-00000000000b','anna@example.de'),
 ('00000000-0000-0000-0000-00000000000c','paul@example.de'),
 ('00000000-0000-0000-0000-00000000000d','fremd@example.de'),
 ('00000000-0000-0000-0000-00000000000e','alt@example.de');
insert into invites values
 ('jacqueline@example.de','Jacqueline','JM','admin',null),
 ('anna@example.de','Anna Keller','AK','member',null),
 ('paul@example.de','Paul Neumann','PN','guest',current_date+20),
 ('alt@example.de','Ex Praktikant','EP','guest',current_date-1);

create function pg_temp.as_user(c text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',
    case c when 'J' then '00000000-0000-0000-0000-00000000000a' when 'A' then '00000000-0000-0000-0000-00000000000b'
           when 'P' then '00000000-0000-0000-0000-00000000000c' when 'X' then '00000000-0000-0000-0000-00000000000d'
           else '00000000-0000-0000-0000-00000000000e' end,
    'email', case c when 'J' then 'jacqueline@example.de' when 'A' then 'anna@example.de' when 'P' then 'paul@example.de' when 'X' then 'fremd@example.de' else 'alt@example.de' end)::text, false) $$;

set role authenticated;
select pg_temp.as_user('J'); select (claim_invite()).role as j_claim;
select pg_temp.as_user('A'); select (claim_invite()).role as a_claim;
select pg_temp.as_user('P'); select (claim_invite()).role as p_claim;
select pg_temp.as_user('X'); select claim_invite() is null as x_no_invite;
select pg_temp.as_user('E'); select (claim_invite()).role as e_claim_expired_guest;

\echo '--- Dienste'
select pg_temp.as_user('A');
insert into shifts values ('00000000-0000-0000-0000-00000000000b', current_date, 'T');
insert into shifts values ('00000000-0000-0000-0000-00000000000a', current_date, 'U'); -- fremder Dienst: muss scheitern
insert into shifts values ('00000000-0000-0000-0000-00000000000b', current_date+1, 'K'); -- Kürzel K: muss scheitern
select pg_temp.as_user('J');
insert into shifts values ('00000000-0000-0000-0000-00000000000b', current_date+2, 'C3'); -- Admin für andere: ok
select count(*) as shifts_seen_by_J from shifts;
select pg_temp.as_user('X'); select count(*) as shifts_seen_by_stranger from shifts;
select pg_temp.as_user('E'); select count(*) as shifts_seen_by_expired_guest from shifts;
select pg_temp.as_user('P'); select count(*) as shifts_seen_by_guest from shifts;

\echo '--- Autos'
select pg_temp.as_user('A');
insert into bookings (car,day,t_from,t_to) values (0,current_date,'08:30','12:00');
select pg_temp.as_user('J');
insert into bookings (car,day,t_from,t_to) values (0,current_date,'11:00','13:00'); -- Überschneidung: muss scheitern
insert into bookings (car,day,t_from,t_to) values (0,current_date,'12:00','13:00'); -- direkt danach: ok
insert into bookings (car,day,t_from,t_to) values (1,current_date,'11:00','13:00'); -- anderes Auto: ok
select pg_temp.as_user('P');
insert into bookings (car,day,t_from,t_to) values (1,current_date,'14:00','15:00'); -- Gast: muss scheitern
select count(*) as bookings_seen_by_guest from bookings;
select pg_temp.as_user('A');
delete from bookings where user_id='00000000-0000-0000-0000-00000000000a'; -- fremde löschen: 0 Zeilen
select count(*) as bookings_after_foreign_delete from bookings;

\echo '--- Eigene Termine'
select pg_temp.as_user('J');
insert into appts (day,t_from,t_to,title) values (current_date,'14:00','15:00','Zahnarzt');
select count(*) as appts_seen_by_owner from appts;
select pg_temp.as_user('A'); select count(*) as appts_seen_by_colleague from appts;
reset role;
select count(*) as appts_total_in_db from appts;
set role authenticated;

\echo '--- Teamtermine'
select pg_temp.as_user('A');
insert into events (day,at,title) values (current_date,'10:00','Abteilungsbesprechung');
select pg_temp.as_user('P');
insert into events (day,title) values (current_date,'Gast-Termin'); -- Gast: muss scheitern
select count(*) as events_seen_by_guest from events;

\echo '--- Einladungen / Profile'
select pg_temp.as_user('A'); select count(*) as invites_seen_by_member from invites;
update profiles set role='admin' where id='00000000-0000-0000-0000-00000000000b';
select pg_temp.as_user('A'); select my_role() as anna_role_after_selfpromote;
select pg_temp.as_user('J'); select count(*) as invites_seen_by_admin from invites;

\echo '--- Kalender-Abo'
select pg_temp.as_user('A'); select count(*) as feeds_seen_by_A from feed_settings;
select reset_feed_token() is not null as token_reset_ok;

reset role;
set role anon;
\echo '--- Anonym'
select count(*) from shifts;
