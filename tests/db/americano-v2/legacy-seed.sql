\set ON_ERROR_STOP on

insert into auth.users(id,email)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','legacy@example.invalid');
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
select set_config('request.jwt.claim.role','authenticated',false);

insert into public.events(id,user_id,state,updated_at)
values (
  '88888888-8888-4888-8888-888888888888',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '{"id":"88888888-8888-4888-8888-888888888888","name":"Legacy upgrade fixture","createdAt":1700000000000,"status":"setup","settings":{},"courts":[],"teams":[],"rounds":[],"format":"king-of-the-court"}'::jsonb,
  '2026-08-20T10:00:00Z'
);

insert into public.signup_events(
  id,owner_user_id,source_event_id,account_slug,title,venue,starts_at,ends_at,
  capacity_teams,details,prizes,is_open,auto_add_pairs,capacity_revision,roster_seeded_at
)
values (
  '77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '88888888-8888-4888-8888-888888888888','legacy-owner','Legacy upgrade fixture','Legacy Court',
  '2026-12-01T10:00:00Z','2026-12-01T12:00:00Z',1,'Legacy details','Legacy prize',true,true,4,now()
);

insert into public.signup_registrations(
  id,signup_event_id,team_name,player_one,player_two,contact,status,created_at,updated_at,pair_completed_at,organizer_rank
)
values
  ('70000000-0000-4000-8000-000000000001','77777777-7777-4777-8777-777777777777','Legacy One','Player A','Player B','legacy-one@example.invalid','confirmed','2026-08-20T10:01:00Z','2026-08-20T10:01:00Z','2026-08-20T10:01:00Z',1),
  ('70000000-0000-4000-8000-000000000002','77777777-7777-4777-8777-777777777777','Legacy Solo','Player C',null,'legacy-solo@example.invalid','looking','2026-08-20T10:02:00Z','2026-08-20T10:02:00Z',null,null),
  ('70000000-0000-4000-8000-000000000003','77777777-7777-4777-8777-777777777777','Legacy Wait','Player D','Player E','legacy-wait@example.invalid','waitlisted','2026-08-20T10:03:00Z','2026-08-20T10:03:00Z','2026-08-20T10:03:00Z',2);

create table public.americano_test_legacy_expected as
select
  (select state from public.events where id='88888888-8888-4888-8888-888888888888') as event_state,
  (select friendly_slug from public.signup_events where id='77777777-7777-4777-8777-777777777777') as friendly_slug,
  (select event_slug from public.signup_events where id='77777777-7777-4777-8777-777777777777') as event_slug,
  (select capacity_teams from public.signup_events where id='77777777-7777-4777-8777-777777777777') as capacity_teams,
  (select jsonb_agg(jsonb_build_object('id',id,'status',status,'team',team_name,'one',player_one,'two',player_two) order by id)
    from public.signup_registrations where signup_event_id='77777777-7777-4777-8777-777777777777') as registrations;
