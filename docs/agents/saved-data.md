# Saved data and compatibility

- Preserve compatibility with data already saved in the database. Browser storage from older versions may be ignored. A change to where or how data is stored must account for existing data.
- Do not change established behaviour that a ticket does not mention. If a change would alter it, bring that back for a decision.
- Every SQL file in `db/`, and every separate query in the README meant to be pasted into Neon, starts with a `-- Version: v1.<ticket number>.<n>` line, so that Robin can check which version is in Neon. Change it only when that file or query changes: `.0` for the first change under a ticket, then `.1`, `.2`. Mention the new version where Robin must run it.
- Keep each `db/` SQL file and README query under 7 KB: Neon's SQL Editor truncates longer pastes. Keep comments short.
