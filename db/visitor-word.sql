-- Version: v1.138.0

-- AD #138: the visitor's random word, stored with every usage record so that
-- visits under different labels from one browser can be joined up. '' if the
-- visitor never opened /demo. Safe to run again. Run it in the Neon SQL Editor
-- for each account store, after db/account-tables.sql.

alter table account_sign_in
    add column if not exists visitor_word text not null default '' check (char_length(visitor_word) <= 30);

alter table account_visit
    add column if not exists visitor_word text not null default '' check (char_length(visitor_word) <= 30);

alter table site_visit
    add column if not exists visitor_word text not null default '' check (char_length(visitor_word) <= 30);
