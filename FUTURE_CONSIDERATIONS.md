# Future considerations

These are observations that may be relevant to future work. They are not
requirements, commitments, or scheduled work.

## Hosting

- Vercel's React Router preset (`@vercel/react-router`): Vercel recommends it
  for per-route function settings and bundle splitting, but its 1.3.7 release
  (2026-09-29) supports only React Router 7, so AD #4 deployed without it.
  Reconsider if a release supports React Router 8 and a feature needs it.

## Screen sizes

- Phone and tablet: descoped by Robin on 2026-10-15 to save testing time, so
  work is designed and checked for desktop only. The phone and tablet layouts
  from AD #18 remain but are no longer tested. Revisit before relying on them.

## Saving projects

- Saves at page leave: since AD #41 Access Projects Across Devices, a
  signed-in account's projects are saved on the server. A save started as the
  page closes is sent with `keepalive`, and the browser asks before leaving
  while a change is unsent or failed, but the save can still be lost if the
  network fails then. Local storage is not used as an offline buffer that
  syncs later, which would also allow editing offline.
- Signed out, the browser's projects still use the later-save-wins rule of
  AD #16 Simple Projects: two tabs saving different fields of one project
  within moments of each other can lose the earlier change (accepted by Robin
  as very unlikely). The per-field check used for accounts could be applied
  there too if it ever matters.

## Tasks

- Undo for task changes other than deletion: AD #33 Add Tasks To Projects
  offers Undo only after a deletion. Each task action is a pure function from
  one task list to another (`app/projects/tasks.ts`), applied to the tasks as
  saved (`saveProjectTasks`), so reversing most actions is simple (un-tick,
  move back, rename back, delete the added tasks). A reversal must still be
  written to cope with a list changed elsewhere, such as in another tab,
  rather than restore a snapshot, which would lose that work. A general Undo
  and Redo also needs decisions on what counts as one step (a pasted block of
  tasks) and when the history ends.

## Calendar

- Deleted Abodeo calendar: with `calendar.app.created`, a calendar the user
  deletes in Google Calendar is still returned by Google and still accepts
  events, which are then not shown (found in AD #10 testing, accepted by Robin
  as a limitation). Robin also accepted it for appointments in AD #65
  Appointments In Projects (2026-10-25). Revisit if it matters: the user would
  need a way to start a new Abodeo calendar, or
  `calendar.calendarlist.readonly`, which shows every calendar the user has.
- The comment above the granted-scope check in
  `app/calendar/calendar-handler.server.ts` says Google's consent screen lets
  the user untick the permission. Google shows tick boxes only when several
  permissions are asked for at once; reword it when that code is next changed.
- Parked from AD #65 Appointments In Projects, not ticketed: Abodeo acting on
  Google with nobody in the app (reading Google changes back, automatic sync,
  reminders). Needs a stored Google token, which AD #73 Store Encrypted Google
  Refresh Token closed as not planned: AD #65 keeps Google's token in an
  encrypted cookie for about an hour instead. Google sends its own reminders.

## Journal

- Text-only journal entries: AD #48 Add Images To Projects shows a project's
  images in a journal-style timeline, each with a date and time and an
  optional caption. Robin plans a ticket soon to add a short piece of text to
  the journal without an image. When AD #48 is planned, keep an entry's date,
  time, caption and ordering independent of its image, so that a text-only
  entry can share them.

## Testing

- Tests for timing fixes: in AD #61 Manage People, Codex's review fixes for
  race and ordering bugs mostly went in without regression tests (revision
  ordering, the removal binding, the profile re-lookup, the form's delayed-add
  guards), because timing code in hooks and components is awkward to test. If
  it happens again, propose a line for `AGENTS.md`: a fix for a race or
  ordering bug gets a test that settles the promises out of order, or its
  decision logic goes into a plain, tested function; if neither is practical,
  the pull request says so.

## Ruled out

- Importing order-confirmation emails through Gmail: ruled out by Robin on
  2026-10-14. Reading Gmail needs Google's restricted scopes, which require a
  paid security assessment before public release. Orders are entered manually.
