-- Version: v1.138.2

-- AD #138: the demo seed's images, replaced with the seed each time Robin
-- saves it: details and both files of every image on the demo account's
-- projects (not in the Bin). The save is refused if they are too big. Safe to
-- run again. Run it in the Neon SQL Editor for each account store, after
-- db/demo-seed.sql.

create table if not exists demo_seed_image (
    project_id text not null,
    id text not null,
    content_type text not null check (content_type in ('image/jpeg', 'image/png')),
    caption text not null default '',
    created_at timestamptz not null,
    task_id text,
    content_hash text not null,
    original bytea not null,
    thumbnail bytea not null,
    primary key (project_id, id)
);
