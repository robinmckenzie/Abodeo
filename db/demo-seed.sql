-- Version: v1.138.1

-- AD #138: the demo seed, one row that Robin replaces each time he saves it
-- from the account panel: the demo account's projects (not in the Bin) as
-- saved, and its people list. Safe to run again. Run it in the Neon SQL Editor
-- for each account store, after db/account-tables.sql.

create table if not exists demo_seed (
    id boolean primary key default true check (id),
    projects jsonb not null,
    people jsonb not null,
    saved_at timestamptz not null default now()
);
