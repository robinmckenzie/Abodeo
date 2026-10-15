# Future considerations

These are observations that may be relevant to future work. They are not
requirements, commitments, or scheduled work.

## Hosting

- Vercel's React Router preset (`@vercel/react-router`): Vercel recommends it
  for per-route function settings and bundle splitting, but its 1.3.7 release
  (2026-09-29) supports only React Router 7, so AD #4 deployed without it.
  Reconsider if a release supports React Router 8 and a feature needs it.

## Saving projects

- Autosave with a database: AD #16 saves project edits automatically to local
  storage. Moving to a database should not mean a request per keystroke:
  save after a pause in typing and when a field or project is closed, send only
  changed fields, and consider keeping local storage as a buffer that syncs in
  the background. Shared projects will also need a way to spot two people
  editing the same project, such as a version number checked on saving.

## Ruled out

- Importing order-confirmation emails through Gmail: ruled out by Robin on
  2026-10-14. Reading Gmail needs Google's restricted scopes, which require a
  paid security assessment before public release. Orders are entered manually.
