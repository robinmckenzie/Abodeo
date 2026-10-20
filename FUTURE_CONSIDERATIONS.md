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

## Ruled out

- Importing order-confirmation emails through Gmail: ruled out by Robin on
  2026-10-14. Reading Gmail needs Google's restricted scopes, which require a
  paid security assessment before public release. Orders are entered manually.
