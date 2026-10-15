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
  saving; for now the later save of a field wins.

## Ruled out

- Importing order-confirmation emails through Gmail: ruled out by Robin on
  2026-10-14. Reading Gmail needs Google's restricted scopes, which require a
  paid security assessment before public release. Orders are entered manually.
