-- Organisers can choose whether confirmed complete pairs are imported into the
-- tournament automatically or reviewed manually. Existing events and
-- templates default to automatic, matching the normal signup workflow.

alter table public.signup_events
  add column if not exists auto_add_pairs boolean not null default true;

alter table public.signup_templates
  add column if not exists auto_add_pairs boolean not null default true;
