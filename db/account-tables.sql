-- Sign-in accounts and profiles for Abodeo (AD #6 Sign in with Google).
--
-- Run this once in the Neon SQL Editor for each account store: production
-- (the database DATABASE_URL points to) and abodeo-local, used by
-- npm run dev. It is safe to run again. The app never creates these tables.
--
-- The auth_ tables are Better Auth's user, session, account and verification
-- tables, renamed and with snake_case columns, as "user" is a reserved word.
-- user_profile, calendar_link, account_sign_in, account_visit, project and
-- project_defaults_received are Abodeo's own. Deleting a row from auth_user
-- deletes that account's sessions, Google link, profile, calendar link,
-- history and projects.
--
-- What is kept: Google's permanent account ID (auth_account.account_id), and
-- the name and email from the first sign-in. The token, scope, image,
-- IP address and user agent columns exist because Better Auth expects them,
-- but the app always leaves them empty.
--
-- calendar_link (AD #10 Prove Calendar Access) keeps the ID of the account's
-- Abodeo calendar in Google Calendar, so that the Calendar test reuses it.
-- No Calendar token is ever kept.
--
-- account_sign_in and account_visit (AD #46 Sign-in History) keep the time of
-- each sign-in, and each visit's start and last activity, so that Robin can
-- see when and for how long testers used Abodeo. Only the account and the
-- server's times are kept: no IP address, browser or device details.
--
-- label (AD #51 Label Account Usage) is the self-declared name a person gave
-- their browser with ?label=NAME, or '' if none. It is stored on every usage
-- record, so that Robin can tell who used an account. It is not used for
-- access. A visit belongs to one label: people using one account at once under
-- different labels each have their own visit. Records from before the label
-- have ''. The alter table statements below add the column to tables created
-- before it, and the visit index is replaced by one that includes it.
--
-- project and project_defaults_received (AD #41 Access Projects Across
-- Devices) keep a signed-in account's projects and their tasks, so that they
-- can be used on every device where the person signs in. data is a project's
-- saved form, as the browser keeps it, so the same version rules apply.
-- revision changes on every write, so that two saves at once cannot both
-- apply. project_defaults_received records which default projects the
-- account has received, as each browser does for itself.
--
-- project_image and project_image_bytes (AD #48 Add Images To Projects) keep
-- the images added to an account's projects. project_image holds each
-- image's details, its caption, and the sizes that count towards the
-- account's 100 MB; project_image_bytes holds the original and the
-- thumbnail, so that the bytes can move elsewhere later without touching the
-- details. An image id is made by the browser, so a retry is recognisable,
-- and content_hash tells a retry from a different image with the same id.
-- Removing a project, or the account, removes its images.

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
    primary key (user_id, id)
);

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
