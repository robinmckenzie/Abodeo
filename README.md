# Abodeo

Tickets are issues in this repository:
https://github.com/robinmckenzie/Abodeo/issues. Each ticket's stage is shown by
one of the labels `STUB`, `DRAFT` or `Agreed`, and is referred to outside GitHub
with the prefix `AD`, such as `AD #3`.

`AGENTS.md` holds the working instructions for agents and people.
ChatGPT also follows the shared `CHATGPT.md` in
[project-starters](https://github.com/robinmckenzie/project-starters), which is
not copied here.

## Prerequisites

- [Node.js](https://nodejs.org/), which includes npm: version 24.15 or later in the 24 series, 22.22.2 or later in the 22 series, or 26 or later.

## Setup

```sh
npm install
```

## Commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the app locally at http://localhost:5173, reloading on changes. |
| `npm run build` | Builds the app for production into `build/`. |
| `npm start` | Serves the production build at http://localhost:3000 (run `npm run build` first). |
| `npm run typecheck` | Checks the TypeScript types. |
| `npm run lint` | Checks the code with ESLint. |
| `npm test` | Runs the tests once with Vitest. |

## Default projects

The default projects are currently empty (AD #75), so new visitors start with a blank dashboard and
anyone who received the earlier defaults has them removed. The rest of this section describes the
mechanism, which still works if projects are saved as defaults again.

Every visitor receives the default projects in `app/projects/default-projects.json`, which each
deployment includes. When a visitor loads a version whose defaults differ from those their browser
last received, the defaults are added or replaced, overwriting any edits to them, and defaults the
file no longer has are removed. Projects the visitor created are left alone, and default projects
alone do not skip the welcome screen. A signed-in account receives the default projects once, by
the same rules, rather than one copy per browser, and a browser's default projects are never moved
into an account. The deployed site is public, so keep anything private out of the default
projects. An account's copy of a default that is kept under the same id keeps its images when the
defaults are refreshed; a default that the file no longer has is removed with its images.

When the app runs with `npm run dev` and `.env.local` has `VITE_SHOW_DEVELOPMENT_PANEL=true`, the
dashboard shows a Development panel (hidden by default):

- **Save as defaults** writes every project in this browser to `app/projects/default-projects.json`.
  Commit that file to include them in the next deployment. In this browser, they then count as the
  default projects, so later edits to them are replaced by the next change to the file unless they
  are saved again first.
- **Reset to defaults** leaves exactly the saved default projects in this browser, removing any
  others and discarding edits.

The panel is not in the deployed app. It always works on this browser's signed-out projects, even
while signed in, and never changes an account's projects. Switching to a branch with a different
defaults file applies that branch's defaults in local development too.

## Sign-in

Anyone with a Google account can sign in, from the dashboard, and set a preferred name that only
they see. A signed-in account can also create a test appointment in Google Calendar (see
[Calendar test](#calendar-test)). Sign-in is optional. Signed out, projects and tasks stay in the
browser. Signed in, the dashboard shows and saves the account's projects instead, kept on the
server, so they can be used on every device where the person signs in (see
[Projects while signed in](#projects-while-signed-in)). Settings, such as the presentation and the
tuning panels, stay in the browser either way.

### How it works

- [Better Auth](https://www.better-auth.com/) 1.7.7 runs in the app's own server code
  (`app/account/*.server.ts`). Every address under `/api` goes to the resource route
  `app/routes/api.ts`, which serves Better Auth's Google endpoints, `/api/account/status`
  (whether sign-in is configured), `/api/account/profile` (the preferred name), `/api/account/activity` (see
  [Sign-in history](#sign-in-history)), `/api/projects` (see
  [Projects while signed in](#projects-while-signed-in)) and the Calendar
  endpoints `/api/calendar/test-appointment`, `/api/calendar/callback`,
  `/api/calendar/connection` and `/api/calendar/appointments` (see
  [Project appointments](#project-appointments)). Any other Better Auth
  endpoint gets a 404.
- Accounts, sessions and profiles are kept in a Neon Postgres database. Production uses the
  database in `DATABASE_URL`. `npm run dev` uses a separate database, `abodeo-local`, through
  `AUTH_DATABASE_URL`, and never reads `DATABASE_URL`, so local accounts never reach production.
- Starting sign-in always asks Google only for the account's identity, name and email, never
  adding a Calendar permission given earlier, and always returns to `/dashboard`, whatever the
  browser sends. Google always asks which account to use.
  Sign-out ends Abodeo's session, not the Google one, and loads the dashboard afresh. Before
  either leaves the page, anything open is saved, and the person is asked first if something
  cannot be saved.
- The dashboard looks up the account after the page has loaded, with an 8-second limit, so a slow
  or missing database never holds it up. It looks again when the window is next used, when the
  session is due to end, and when another tab signs out.
- `public/privacy.html` is the public privacy page that Google's sign-in screen links to.

### What is stored

From Google, only the account's permanent ID (`auth_account.account_id`) and the name and email
received at the first sign-in, which later sign-ins do not refresh. Then the preferred name, if
set (`user_profile`), and one session row per signed-in browser, deleted on sign-out. Google's
tokens, the profile photo, and the IP address and browser details of a sign-in are never stored:
their columns exist because Better Auth expects them, and are always empty. Tests in
`app/account/` check this. The Calendar test adds the ID of the account's Abodeo calendar
(`calendar_link`), once one has been made. The sign-in history adds `account_sign_in` and
`account_visit`, both with the usage label (see [Usage labels](#usage-labels)). The account's
projects and their tasks are in `project`, and which default
projects it has received in `project_defaults_received`. The images added to its projects are in
`project_image` (details, caption and sizes) and `project_image_bytes` (the files). The people its
projects can be assigned to are in `account_people`.

### Projects while signed in

AD #41 Access Projects Across Devices. The code is in `app/projects/project-*.server.ts` and
`app/projects/account-projects.ts`.

- Each project is a row of `project`, keyed by account and project id, holding the same saved form
  as the browser keeps, so a project saved by a later version is never overwritten. Whose projects
  are read or changed comes only from the session. Every request also names the account the page
  is working for, in `X-Abodeo-Account`, and is refused if it differs, so a page left open for one
  account cannot change another's after a sign-in in another tab.
- The account's projects are held only in the page's memory, never in browser storage, so signing
  out, which reloads the page, leaves none behind. Until the sign-in is known, or if it cannot be
  checked, no projects are shown, so that a signed-in person never edits the browser's by mistake.
- A save sends, for each field it changes, the value it was based on. A field changed elsewhere
  since is refused: the form says "This project was changed on another device." and offers "Use
  saved version" or "Keep mine". A change to the tasks is applied again to tasks changed
  elsewhere, unless both touch the same task or both change the order, when it is not saved and
  the saved tasks are shown.
- Opening a project loads its latest copy first, and it cannot be changed until that arrives. The
  list is loaded again when the window comes back into use, at most every 10 seconds.
- On signing in with projects of the browser's own, the dashboard offers to move them in. Moving
  sends each one; the server adds a copy rather than replacing a different project with the same
  id, and sending the same projects again adds nothing. Each project is then removed from the
  browser only if it has not changed there since. "Not now" is remembered until the next sign-in
  or sign-out.
- The welcome screen is chosen before the page loads, so while signed in the browser keeps a yes
  or no hint, `abodeo-account-has-projects`, of whether the account has projects of its own. It
  holds no project data and is removed on signing out.
- While signed in, the browser asks before the page is left while a change is still being sent or
  has failed to save. A save started as the page closes is sent so that it can finish afterwards,
  but can still be lost if the network fails then.
- Provisional limits: a request body of 256 KB, or 1 MB when moving projects in.

### People

AD #61 Manage People. The code is in `app/projects/people*.ts`, `account-people.ts`,
`use-people.ts` and `app/routes/people.tsx`.

- The application menu (the Projects and People links below the account area, shown on every
  screen with the sign-in button) has a People entry, which opens
  the People screen at `/people`. There people are added, renamed and removed. A project saves
  only a person's id, so a rename changes no project. Unassigned is always the first option in
  Assigned To, and is not a person: it cannot be added, renamed or removed.
- A name is trimmed, has runs of spaces joined, and is 1 to 40 characters, different from every
  other name whatever the case, and not "Unassigned". The same rules apply in the browser and on
  the server.
- The list is kept where the projects are: signed out, in the browser (`abodeo-people`); signed
  in, in the account (`account_people`, one row holding the whole list, reached through
  `/api/people`, which is read with GET and changed with POST: add, rename, remove and
  establish). A new list starts empty. A store whose projects are already assigned to Andy, Boris
  or Clement starts with those people, saved the first time it is read. The default projects are
  all Unassigned, so receiving them once resets any edits to received default projects.
- Reading an account's list never writes. With no list saved yet, the people its projects are
  assigned to are shown, and the list is saved by the first change to it, by moving the browser's
  projects in, or once the offer to move them has been settled.
- A text box below the people in Assigned To adds a person and assigns them to the open project.
- Removing someone assigned to projects asks first, saying how many, and then sets those projects
  to Unassigned. The server counts them (a dry run), and a removal sent with that count changes
  nothing, and answers with the new count, if the count has changed since. Projects that cannot
  be read are left as they are, and are reported. In the browser, removal sets the projects one
  by one, so it is not atomic, and takes turns with assigning in other tabs using Web Locks where
  the browser has them.
- The server checks that a person chosen for a project is in the account's list, as the write is
  made (the list row is held until then), and refuses with `unknown_assignee` otherwise, as
  happens when someone is removed on another device. The browser does the same for its own list.
  A project already assigned to someone no longer in the list shows as Unassigned until edited.
- Moving the browser's projects in takes its list too. If the account has no list, the browser's
  becomes the account's and people carry by id. If it has one, each project's person is matched
  to the account's by name, whatever the case, and anyone without a match becomes Unassigned.
  Sending the same move again after someone was renamed finds the projects already moved.
- Rolling the app back to a version before this makes projects assigned to people added since
  unreadable to it.

### Images on projects

AD #48 Add Images To Projects. The code is in `app/projects/image-*.ts`, `images-*.ts`,
`use-project-images.ts`, `project-images.tsx` and `thumbnail.ts`.

- Only an account's own projects have images. Signed out, a project shows "Sign in to add images".
  A person adds JPEG or PNG images with the Add image button, or by dropping them on the page,
  which adds them to the open project (and says why when none is open, or the open one is new and
  not yet saved).
- AD #54 Change UX While Dropped Images Are Added. Messages about images float at the bottom
  centre (`floating-messages.tsx`), each fading after `messageDuration` (5 s, with a 0.6 s fade),
  at most 10 at once and one more saying the rest are suppressed. While files are dragged over the
  page (`use-file-drag.ts`), the page dims outside the open project if a drop would be accepted,
  and otherwise the reason is shown once with a not-allowed cursor (including when every file dragged is
  known, by its type, not to be a JPEG or PNG). Each file being added shows a
  spinner placeholder with its name in the timeline until the image replaces it. Batches of files
  run one after another.
- A project with images shows the thumbnail of its newest one at the right of its bar. The project
  list answer carries the newest image id of each project (`latestImageIds`, one query), and the
  browser fetches those thumbnails with the same checks as any image, holding them in memory only
  (`use-bar-thumbnails.ts`). The open project's images keep its bar up to date as they change.
- Each image is a row of `project_image` (its id, type, sizes, caption and time) and two rows of
  `project_image_bytes` (the original and a thumbnail), which go with the image, the project or
  the account when any is removed. The bytes are behind `ImageBytesStore`
  (`image-bytes-store.server.ts`), so they can move to another store later, such as Vercel Blob,
  without touching the details. They are read as base64, as the driver would give bytea as hex,
  twice the size.
- The browser decodes each file, draws a thumbnail (at most 100 KB, usually 20 to 40 KB) and sends
  both in one binary request, with an id it made, so that sending it again after a lost answer
  gives the same image. The server decides the type from the file's content, and checks the
  structure of both files (PNG chunk lengths and checksums, JPEG markers and ends). It does not
  decode pixels, so a hand-made request could store damaged pixel data, in its own account only.
- Provisional limits, in `images-api.ts`: 4 MiB per image, 100 KB per thumbnail, 100 MB of images
  and thumbnails per account, captions of 500 characters (counted as people count them), and 100
  images in each answer of the list. The largest request is 4,296,708 bytes, under Vercel's limit
  of 4.5 MB for a request or response, which a test checks. Uploads of one account are serialised
  by a lock on its `auth_user` row, so two at once cannot both pass the 100 MB.
- Images have no public address. Each is fetched with the same session and `X-Abodeo-Account`
  check as projects, shown from a blob URL held only in memory, and never cached (`no-store`,
  `nosniff`). Changes need a JSON or binary type and the account header, which another site
  cannot send, and a request naming another origin is refused. Photos are stored exactly as
  added, including any location data.
- A caption is saved with the caption it was based on. If another device saved a different one
  meanwhile, the saved one is kept and the page says so. Captions of different images never clash.
- Not included: sharing, live updates on other devices, offline use, editing an image, and
  images on signed-out projects.

### Sign-in history

Abodeo keeps each account's sign-ins and visits, so that Robin can see when and for how long
testers used it (AD #46 Sign-in History). There is no screen for it: Robin reads it with the query
under [Inspecting and removing an account](#inspecting-and-removing-an-account).

- Each new session, which only a sign-in makes, adds a row to `account_sign_in`, through a Better
  Auth hook. Signing out leaves it. If the row cannot be written within 3 seconds, the sign-in
  goes ahead without it and `account_history_failed` is logged.
- While signed in, the page posts to `/api/account/activity` on a click (`pointerdown`) or
  keypress, at most once a minute per tab. An idle tab sends nothing. The server extends the
  account's latest visit in `account_visit`, or starts a new one if the last activity was 10 or
  more minutes ago. Both limits are provisional defaults, in `app/account/activity-report.ts` and
  `app/account/account-history.server.ts`.
- Only the account, the server's times and the [usage label](#usage-labels) are kept, never the
  browser's clock, IP address or details. The rows are deleted with the account.
- Times are accurate to about a minute: a click within a minute of the last report is not sent, so
  a visit's last-active time can be up to a minute early, and a visit can end after 9 to 10
  minutes without activity. A visit with a single report has a length of 0.

### Usage labels

AD #51 Label Account Usage. A label is a short, self-declared name for a browser, such as a first
name, stored with every usage record so that Robin can tell who used an account, whether it is
shared or not. It is not used for access and is not shown to other users.

**Rule: every usage record, including any added in future, must store the label.** Call
`readLabel(request.headers)` from `app/account/usage-label.server.ts` where the record is made,
and store the result in a `label text not null default ''` column. It gives `""` when there is no
valid label. A record that spans a period, as a visit does, belongs to one label.

- Set it by opening the app with `?label=NAME` on any address, such as `/?label=Andrew`. Open
  `?label=PUBLIC` (any case) to clear it. The page saves it in the `abodeo_label` cookie, then
  removes `label` from the address.
- A label is 1 to 30 characters after trimming: Unicode letters, digits, space, hyphen,
  apostrophe and full stop. An invalid or empty `?label=` changes nothing, so the previous label
  stays.
- The cookie lasts a year from when it was last set, survives reloads, restarts, sign-out and
  other tabs, and is shared by everyone using that browser. It is limited to `/api` paths, so it
  reaches sign-in, including Google's return to `/api/auth/callback/google`, and the activity
  report. Page scripts can read it, as the browser sets it.
- Sign-ins store the label sent with the request that creates the session. Activity reports
  store the label sent with each report, so a change applies from the next report, up to a
  minute later.
- A visit is per account and label: people using one account at the same time under different
  labels each have their own running visit, rather than ending each other's. A lock per account
  and label stops two simultaneous first reports from both starting a visit.
- Records from before labels have an empty label. A visit begun before is continued by activity
  with no label.
- Existing databases need `db/account-tables.sql` run again, in Neon's SQL Editor for each
  database, before the new code is deployed. It adds the columns and replaces the visit index.
- If the label cannot be read or saved, the app works and the record has an empty label.

### Calendar test

The account panel's "Create test appointment" proves that Abodeo can add appointments to Google
Calendar (AD #10 Prove Calendar Access). The code is in `app/calendar/`.

- Signing in never asks for Calendar access. The button posts to `/api/calendar/test-appointment`,
  which answers with Google's address. Abodeo asks only for `openid` and `calendar.app.created`,
  which lets it make its own calendars and manage their events, and nothing else in the person's
  Google Calendar. Google classes it as non-sensitive. It suggests the signed-in Google account
  and asks for an online token, so Google issues no refresh token.
- The state and PKCE verifier are kept for 10 minutes in an `HttpOnly` cookie for `/api/calendar`
  only, encrypted with `BETTER_AUTH_SECRET`. Better Auth's tables and endpoints are not used.
- Google returns to `/api/calendar/callback`, which checks the cookie, the session and that the
  permission was ticked, refuses a Google account other than the signed-in one, and exchanges the
  code for a token. The token is never saved in the database or logged. It is used for the test
  and kept for up to an hour in the cookie described under
  [Project appointments](#project-appointments).
- The appointment, "Abodeo test appointment", is at the next whole hour for 30 minutes, in a
  calendar named Abodeo. The first test makes the calendar and saves its ID in `calendar_link`.
  Later tests reuse it, or make a new one if Google answers that it cannot be found. If two tests
  run at once, only one calendar is kept.
- The callback returns to `/dashboard?calendar=` with `created`, `denied`, `wrong-account` or
  `failed`, which the dashboard shows once and removes from the address.
- The calendar cannot be found through the person's calendar list, as the permission does not
  cover it, which is why its ID is saved. Abodeo cannot tell whether the person has deleted or
  hidden it: in testing, a calendar permanently deleted in Google Calendar was still returned by
  Google and still accepted appointments, which were then not shown. Abodeo reports them as
  created.

### Project appointments

A project shows and adds appointments (AD #70 Add Appointments To Projects). They are events in
the account's Abodeo calendar in Google Calendar, and Abodeo keeps no copy. The code is in
`app/calendar/` and `app/projects/project-appointments.tsx`.

- Each event has the project's ID in a private extended property (`abodeoProject`), which only
  the client that wrote it can see, so a project lists just the events Abodeo made for it. The
  title is the event's summary and the notes its description. An all-day appointment is a single
  day (`date` fields), a timed one uses a local date-time and the browser's time zone, and the end
  defaults to an hour after the start.
- A grant keeps Google's access token for up to 55 minutes (or Google's expiry if sooner) in a
  second encrypted cookie, `abodeo_calendar_token`, `HttpOnly` and scoped to `/api/calendar`. It
  is read only if it was made for the signed-in account, is cleared at sign-out, and is never in
  the database or logs. The browser never sees it: every Google call is made by
  `/api/calendar/connection` (is the token good for more than five minutes?) and
  `/api/calendar/appointments` (list by `projectId`, and add), which name the account the page
  works for, as the projects endpoints do.
- Opening a project lists its appointments. With no good token it answers `needs-grant`: an
  account that has an Abodeo calendar (has connected before) goes through Google by itself and
  returns to the project, once per page load and not straight after a refusal or failure; any
  other sees a Connect Google Calendar button. Opening the form checks the token first and goes
  through Google if it is missing or near expiry. A save with an expired token creates nothing.
- Google returns to `/dashboard?project=<id>&appointment=new&calendar=connected`, which opens the
  project (and its form) once its projects have loaded, then cleans the address.
- If Google cannot be reached, or the list cannot be read in full, the project says appointments
  cannot be shown rather than showing none.

### Setting it up from scratch

Robin enters every secret value directly. None is committed, put in browser code or shown in
output. The production address is https://abodeo-kappa.vercel.app.

1. **Google Cloud Console** (no billing is needed; ignore any Upgrade prompt):
    1. Create a project named Abodeo.
    2. Google Auth Platform, Get started: app name Abodeo, a support email (everyone signing in
       sees it), audience External, a contact email.
    3. Branding: no logo, as a logo needs Google's verification.
    4. Data Access: Add or remove scopes, tick only `.../auth/userinfo.email`,
       `.../auth/userinfo.profile`, `openid` and `.../auth/calendar.app.created`, then Update,
       then Save. All four are non-sensitive.
    5. Audience: stay in Testing, with Robin as a test user, until production is ready. Testing
       allows 100 test users over the app's lifetime. Google says only test users can sign in, but
       an account not on the list did so during testing, so do not rely on it.
    6. Clients: create an OAuth client of type Web application, with the redirect URIs
       `https://abodeo-kappa.vercel.app/api/auth/callback/google`,
       `http://localhost:5173/api/auth/callback/google`,
       `https://abodeo-kappa.vercel.app/api/calendar/callback` and
       `http://localhost:5173/api/calendar/callback`. Its secret is shown in full only once.
    7. APIs & Services, Library: enable the Google Calendar API. Without it, every Calendar call
       fails.
2. **Neon, through Vercel** (Storage, under the project's Infrastructure): create two Neon
   databases on the free plan.
    - `abodeo`: on Connect a Project, choose the Abodeo project and the Production environment
      only, with no database branch for deployment. In the database's Settings, set Allowed
      Environments to "Production environment only" and save. The project's Settings,
      Environment Variables, should then list `DATABASE_URL` for Production only. Then click
      "← All Databases", at the top left, to go back.
    - `abodeo-local`: connect it to no environment (or Development only, if Vercel insists). Its
      connection string goes in `.env.local`. Do not use a branch of production instead, as a
      branch starts as a copy of production's accounts.
3. **Tables**: in each database's SQL Editor in Neon, replace the sample query with the contents
   of `db/account-tables.sql` and run it. It is safe to run again. The Tables view then lists
   `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `user_profile`,
   `calendar_link`, `account_sign_in`, `account_visit`, `project`,
   `project_defaults_received`, `project_image`, `project_image_bytes` and `account_people`.
4. **Variables**:

    | Variable | Production (Vercel) | `.env.local` |
    | --- | --- | --- |
    | `GOOGLE_CLIENT_ID` | from the OAuth client | the same |
    | `GOOGLE_CLIENT_SECRET` | from the OAuth client | the same |
    | `BETTER_AUTH_SECRET` | its own random value | a different random value |
    | `BETTER_AUTH_URL` | `https://abodeo-kappa.vercel.app` | `http://localhost:5173` |
    | `DATABASE_URL` | set by the Neon connection | never set |
    | `AUTH_DATABASE_URL` | not set | `abodeo-local`'s connection string |

    In PowerShell, `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | Set-Clipboard`
    puts a new secret on the clipboard without showing it. Restart
    `npm run dev` after changing `.env.local`. Sign-in works locally only at
    http://localhost:5173, the address registered with Google.
5. **Publishing the Google app**, once production has deployed with the variables: in Branding,
   set the home page to the production address, the privacy policy link to
   https://abodeo-kappa.vercel.app/privacy.html and the authorised domain to
   `abodeo-kappa.vercel.app` (Vercel's `vercel.app` is a public suffix, so the full address is
   the domain). Then publish the app in Audience. With only these basic permissions and no logo,
   Google needs no verification.

Vercel previews have no sign-in, and report it as unavailable.

### Inspecting and removing an account

In the Neon SQL Editor for the right database:

```sql
-- Version: v1.41.0
--
-- Every account, with what is kept about it and how many projects it has.
select u.id, u.name, u.email, u.created_at, a.account_id as google_id, p.preferred_name,
    c.calendar_id, (select count(*) from project j where j.user_id = u.id) as projects
from auth_user u
left join auth_account a on a.user_id = u.id
left join user_profile p on p.user_id = u.id
left join calendar_link c on c.user_id = u.id;

-- Version: v1.51.0
--
-- Each account's sign-ins and visits, newest first, with the usage label ('' if none) and each
-- visit's length.
select u.email, s.label, 'sign-in' as kind, s.signed_in_at as at, null::interval as length
from account_sign_in s
join auth_user u on u.id = s.user_id
union all
select u.email, v.label, 'visit', v.started_at, v.last_active_at - v.started_at
from account_visit v
join auth_user u on u.id = v.user_id
order by email, at desc;

-- Version: v1.48.0
--
-- How much each account uses of its 100 MB of images, and the total, in MB.
select u.email, count(*) as images,
    round(sum(i.original_size + i.thumbnail_size) / 1048576.0, 1) as mb
from project_image i
join auth_user u on u.id = i.user_id
group by u.email
union all
select 'total', count(*), round(coalesce(sum(original_size + thumbnail_size), 0) / 1048576.0, 1)
from project_image;

-- Version: v1.48.0
--
-- Removes an account, with its sessions, Google link, profile, calendar link, history,
-- projects and images.
delete from auth_user where email = 'someone@example.com';
```

To check that nothing extra is stored, `auth_account`'s token and scope columns, `auth_user.image`
and `auth_session`'s `ip_address` and `user_agent` should all be empty.

### Costs

Everything is on free tiers: Google sign-in costs nothing, the Neon free plan allows each
database 1 GB of storage, 100 compute-hours and 5 GB of network transfer a month (it sleeps when
unused), and the Vercel Hobby plan covers the function, with 100 GB of fast data transfer,
1,000,000 invocations a month and a limit of 4.5 MB on a request or response body. Nothing needs a
paid plan or an upgrade. These figures were checked against Neon's and Vercel's documents on
2026-10-22.

Images (AD #48) share the database with sign-in and projects, so they are the main use of it:

- **Storage**: each account may keep 100 MB of images. With fewer than 5 testers (Robin, Andrew and
  perhaps Robin's father) the worst case is half of the 1 GB. Beyond about 8 full accounts there
  is no room for projects, and uploads are refused with a message while existing data is kept.
  There is no limit across accounts, by Robin's decision.
- **Transfer** is the tightest limit. Opening a project with 40 images sends about 1.6 MB of
  thumbnails, and a full-size view up to 5.6 MB (base64). Thumbnails are small, fetched when they
  come into view, and kept in memory, so they are not fetched again in the same page. Check
  Neon's usage page after the first week of testing.
- **If a limit is reached**, Neon suspends the database or refuses writes, which also stops
  sign-in and project saves until the next month, or until space is freed. Use the usage query
  under [Inspecting and removing an account](#inspecting-and-removing-an-account) to watch it.

## Deployment

Abodeo is hosted on [Vercel](https://vercel.com/) at
https://abodeo-kappa.vercel.app/. Anyone with that address can open it without
a Vercel account. The other addresses Vercel generates for each deployment ask
for a Vercel login, because the project uses Vercel's Standard Protection.

### How it is set up

- The Vercel project `abodeo`, on Robin's Hobby plan, is connected to this
  repository. Vercel detects React Router, builds with `npm run build` and
  serves the server rendering as a Vercel Function on Node.js 24.x.
- No Vercel package is installed, so the build warns that Vercel's React Router
  preset was not detected. That is expected.
- The Production environment has the sign-in variables listed under
  [Sign-in](#sign-in). Without them the app still works, with sign-in
  reported as unavailable.
- `main` is the production branch. `vercel.json` turns off deployment for every
  other branch, so pushing a branch or opening a pull request deploys nothing.

### Setting up the Vercel project

This was done once, and is only needed again if the project is recreated.
Importing deploys straight away, so Robin approves the first deployment before
it starts.

1. Make sure `main` contains `vercel.json`, so that only `main` deploys from the
   start.
2. In Vercel, choose Add New, then Project, and import `robinmckenzie/Abodeo`
   from GitHub, giving Vercel's GitHub app access to the repository if asked.
3. Choose Robin's Hobby team and the project name `abodeo`. Keep the detected
   Application Preset, React Router, and leave the build and output overrides
   switched off. Add no environment variables. Selecting Deploy starts the
   first deployment. Vercel added the suffix `-kappa` to the address because
   `abodeo.vercel.app` was taken.
4. In the project's settings, confirm that the production branch is `main`
   (Environments, then Production), the Node.js version is 24.x (Build and
   Deployment) and Vercel Authentication is on with Standard Protection
   (Security, then Deployment Protection).

### How a change reaches production

- Merging or pushing into `main` deploys that commit to production
  automatically. Approving the merge or push therefore approves the deployment,
  as `AGENTS.md` says.
- Any other deployment, such as using Redeploy in Vercel after a failed build,
  needs Robin's approval first.
- A page opened before a deployment keeps running the old code until it is
  reloaded, so check a new deployment in a fresh window.

### Checking a deployment

Robin checks each production deployment. Agents do not run checks against the
deployed site.

1. In the Vercel project's Deployments list, the newest Production deployment
   is Ready and shows branch `main` and the same commit ID and message as the
   latest commit on `main` in GitHub.
2. Open the production address in a private window that is not signed in to
   anything. The welcome screen appears without a sign-in prompt.
3. In the browser's developer tools, the Console shows no errors and the
   Network tab shows the styles and scripts loaded without failures.
4. Open an address that does not exist, such as `/no-such-page`. The 404 page
   appears.

### Trying Vercel's build locally

To check Vercel's build without deploying, create `.vercel/project.json`
containing `{"projectId":"_","orgId":"_","settings":{"framework":"react-router"}}`
and run `npx vercel build`. The output goes to `.vercel/output`, which Git
ignores.
