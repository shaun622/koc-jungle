-- Correct the published Monday Night KoC page to match its four tournament
-- team slots. The existing capacity trigger re-ranks only this signup list.
update public.signup_events
set
  capacity_teams = 4,
  updated_at = now()
where account_slug = 'shaun'
  and event_slug = '24-aug-2026-monday-night-koc'
  and capacity_teams is distinct from 4;
