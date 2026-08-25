-- Filtered Realtime DELETE events only include non-PK filter columns when
-- the table keeps the full old row. Cloud sync filters events by user_id.
alter table public.events replica identity full;
