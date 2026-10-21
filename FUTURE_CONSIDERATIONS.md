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

- Autosave with a database: AD #16 Simple Projects saves project edits
  automatically to local storage, already after a 0.5-second pause in typing
  and when a field or project is closed, sending only changed fields
  (`app/projects/autosave.ts`). Moving to a database means replacing the
  functions in `app/projects/project-storage.ts`, which are async for that
  reason. Consider keeping local storage as a buffer that syncs in the
  background. A save started as the page is left must still complete, which a
  network request may not. Shared projects will also need a way to spot two
  people editing the same project, such as a version number checked on
  saving. For now the later save of a field wins, and, as each project is one
  entry, two tabs saving different fields of one project within moments of
  each other can lose the earlier change (accepted by Robin for AD #16 Simple
  Projects as very unlikely). The welcome screen's splash for a returning
  visitor also depends on local storage: `hasProjectsScript`, in the same
  file, looks there for projects before the page first appears and sets
  `data-has-projects`. With a database, the server would set the attribute
  when it renders the page instead. The default projects (AD #36 Save Default
  Projects) are written into the same storage, and the browser's record of
  which it received, which that script also reads, would move with them.

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

- Calendar access without a redirect each time: AD #10 Prove Calendar Access
  uses Google's Calendar token once and never stores it, as AD #6 Sign In With
  Google decided. Project appointments built the same way would send the user
  through Google for each appointment. Google skips its permission screen after
  the first grant, and AD #10 names the account, so there is no account
  chooser either: the redirect is a quick round trip. Background work, such as keeping appointments in sync, would not
  be possible. The options are storing an encrypted refresh token, which
  reverses the AD #6 decision, or keeping the short-lived token for about an
  hour, so one redirect covers a sitting. Decide when appointment features are
  drafted.
- Deleted Abodeo calendar: with `calendar.app.created`, a calendar the user
  deletes in Google Calendar is still returned by Google and still accepts
  events, which are then not shown (found in AD #10 testing, accepted by Robin
  as a limitation). Appointment features may need a way for the user to start
  a new Abodeo calendar, or `calendar.calendarlist.readonly`, which shows every
  calendar the user has.
- Opening the right Google account: the "Open Google Calendar" link opens the
  browser's default Google account, which may not be the one signed in to
  Abodeo. Adding `?authuser=<email>` (as in
  `https://calendar.google.com/calendar/u/?authuser=...`) would open the
  signed-in account's calendar.
- The comment above the granted-scope check in
  `app/calendar/calendar-handler.server.ts` says Google's consent screen lets
  the user untick the permission. Google shows tick boxes only when several
  permissions are asked for at once; reword it when that code is next changed.

## Ruled out

- Importing order-confirmation emails through Gmail: ruled out by Robin on
  2026-10-14. Reading Gmail needs Google's restricted scopes, which require a
  paid security assessment before public release. Orders are entered manually.
