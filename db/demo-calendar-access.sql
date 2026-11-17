-- Version: v1.138.3

-- Calendar access for the demo account (AD #138 Demo Entry And Seed). Run it
-- in the Neon SQL Editor for each account store: production (DATABASE_URL)
-- and abodeo-local. Safe to run again. Run it after db/account-tables.sql.

-- demo_calendar_access: at most one row, Google's refresh token for the demo
-- account's Calendar permission, encrypted with BETTER_AUTH_SECRET. It lets
-- demo visitors see and add appointments without going to Google. No other
-- account's token is ever saved. Deleting the row removes the access.

create table if not exists demo_calendar_access (
    id boolean primary key default true check (id),
    user_id text not null references auth_user (id) on delete cascade,
    refresh_token text not null,
    saved_at timestamptz not null default now()
);
