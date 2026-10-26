-- Version: v1.94.0

-- Create script for Abodeo's account tables. Run it in the Neon SQL Editor
-- for each account store: production (DATABASE_URL) and abodeo-local (used
-- by npm run dev). Safe to run again. The app never creates these tables.
-- Keep this file under about 7 KB: Neon's editor truncates longer pastes.

-- auth_ tables: Better Auth's user, session, account and verification
-- tables, renamed with snake_case columns. The token, scope, image, IP and
-- user agent columns exist because Better Auth expects them; the app leaves
-- them empty. Deleting an auth_user row deletes everything of that account.
-- calendar_link (AD #10): the ID of the account's Abodeo calendar. No token.
-- account_sign_in, account_visit (AD #46, #51): sign-in and visit times, and
-- the self-declared label ('' if none). No IP address or device details.
-- project, project_defaults_received (AD #41): an account's projects. data
-- is the saved form; revision changes on every write.
-- deleted_at (AD #62): when a project was put in the Bin, or null. Binned
-- projects are cleared for good by the dashboard's next load or save once
-- past the cooling-off period, or at once by Delete permanently.
-- project_image, project_image_bytes (AD #48): images, details apart from
-- bytes. Removing a project or account removes its images.
-- account_people (AD #61): one row per account, the ordered people list.
-- site_visit (AD #94): a visit before sign-in: time, label, ?welcome, bot
-- flag, host's country and city, emailed. No account, IP or user agent.

create table if not exists auth_user (
    id text primary key,
    name text not null,
    email text not null unique,
    email_verified boolean not null default false,
    image text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists auth_session (
    id text primary key,
    expires_at timestamptz not null,
    token text not null unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    ip_address text,
    user_agent text,
    user_id text not null references auth_user (id) on delete cascade
);

create index if not exists auth_session_user_id_idx
    on auth_session (user_id);

create table if not exists auth_account (
    id text primary key,
    account_id text not null,
    provider_id text not null,
    user_id text not null references auth_user (id) on delete cascade,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    scope text,
    password text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (provider_id, account_id)
);

create index if not exists auth_account_user_id_idx
    on auth_account (user_id);

create table if not exists auth_verification (
    id text primary key,
    identifier text not null,
    value text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists auth_verification_identifier_idx
    on auth_verification (identifier);

create table if not exists user_profile (
    user_id text primary key references auth_user (id) on delete cascade,
    preferred_name text not null check (char_length(preferred_name) between 1 and 50),
    updated_at timestamptz not null default now()
);

create table if not exists calendar_link (
    user_id text primary key references auth_user (id) on delete cascade,
    calendar_id text not null,
    updated_at timestamptz not null default now()
);

create table if not exists account_sign_in (
    id bigint generated always as identity primary key,
    user_id text not null references auth_user (id) on delete cascade,
    signed_in_at timestamptz not null default now(),
    label text not null default '' check (char_length(label) <= 30)
);

alter table account_sign_in
    add column if not exists label text not null default '' check (char_length(label) <= 30);

create index if not exists account_sign_in_user_id_idx
    on account_sign_in (user_id, signed_in_at);

create table if not exists account_visit (
    id bigint generated always as identity primary key,
    user_id text not null references auth_user (id) on delete cascade,
    started_at timestamptz not null default now(),
    last_active_at timestamptz not null default now(),
    label text not null default '' check (char_length(label) <= 30)
);

alter table account_visit
    add column if not exists label text not null default '' check (char_length(label) <= 30);

drop index if exists account_visit_user_id_idx;

create index if not exists account_visit_user_label_idx
    on account_visit (user_id, label, last_active_at desc);

create table if not exists project (
    user_id text not null references auth_user (id) on delete cascade,
    id text not null,
    data jsonb not null,
    revision bigint not null default 1,
    deleted_at timestamptz,
    primary key (user_id, id)
);

alter table project add column if not exists deleted_at timestamptz;

create table if not exists project_defaults_received (
    user_id text primary key references auth_user (id) on delete cascade,
    hash text not null,
    ids jsonb not null
);

create table if not exists project_image (
    user_id text not null,
    project_id text not null,
    id text not null,
    content_type text not null check (content_type in ('image/jpeg', 'image/png')),
    original_size integer not null check (original_size between 1 and 4194304),
    thumbnail_size integer not null check (thumbnail_size between 1 and 102400),
    content_hash text not null,
    caption text not null default '' check (char_length(caption) <= 500),
    created_at timestamptz not null default now(),
    primary key (user_id, project_id, id),
    foreign key (user_id, project_id) references project (user_id, id) on delete cascade
);

create index if not exists project_image_account_idx
    on project_image (user_id);

create table if not exists project_image_bytes (
    user_id text not null,
    project_id text not null,
    image_id text not null,
    kind text not null check (kind in ('original', 'thumbnail')),
    data bytea not null,
    primary key (user_id, project_id, image_id, kind),
    foreign key (user_id, project_id, image_id)
        references project_image (user_id, project_id, id) on delete cascade
);

create table if not exists account_people (
    user_id text primary key references auth_user (id) on delete cascade,
    data jsonb not null,
    revision bigint not null default 1
);

create table if not exists site_visit (
    id bigint generated always as identity primary key,
    visited_at timestamptz not null default now(),
    label text not null default '' check (char_length(label) <= 30),
    welcome boolean not null,
    is_bot boolean not null,
    country text not null default '',
    city text not null default '',
    emailed boolean not null default false
);
