-- Version: v1.138.4

-- AD #138: the demo seed's appointments. Run it in the Neon SQL Editor for
-- each account store, after db/demo-seed.sql. Safe to run again.

-- The calendar events of the seed's projects as Robin last saved them, as
-- JSON. A new visitor's reset recreates them in Google Calendar.
alter table demo_seed
    add column if not exists appointments jsonb not null default '[]'::jsonb;
