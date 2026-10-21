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

Every visitor receives the default projects in `app/projects/default-projects.json`, which each
deployment includes. When a visitor loads a version whose defaults differ from those their browser
last received, the defaults are added or replaced, overwriting any edits to them, and defaults the
file no longer has are removed. Projects the visitor created are left alone, and default projects
alone do not skip the welcome screen. The deployed site is public, so keep anything private out of
the default projects.

When the app runs with `npm run dev`, the dashboard shows a Development panel:

- **Save as defaults** writes every project in this browser to `app/projects/default-projects.json`.
  Commit that file to include them in the next deployment. In this browser, they then count as the
  default projects, so later edits to them are replaced by the next change to the file unless they
  are saved again first.
- **Reset to defaults** leaves exactly the saved default projects in this browser, removing any
  others and discarding edits.

The panel is not in the deployed app. Switching to a branch with a different defaults file applies
that branch's defaults in local development too.

## Sign-in

Anyone with a Google account can sign in, from the dashboard, and set a preferred name that only
they see. A signed-in account can also create a test appointment in Google Calendar (see
[Calendar test](#calendar-test)). Sign-in is optional: projects, tasks and settings stay in the
browser either way, and are not linked to the account.

### How it works

- [Better Auth](https://www.better-auth.com/) 1.7.7 runs in the app's own server code
  (`app/account/*.server.ts`). Every address under `/api` goes to the resource route
  `app/routes/api.ts`, which serves Better Auth's Google endpoints, `/api/account/status`
  (whether sign-in is configured), `/api/account/profile` (the preferred name) and the Calendar
  test's `/api/calendar/test-appointment` and `/api/calendar/callback`. Any other Better Auth
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
(`calendar_link`), once one has been made.

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
  code for a token. The token is used for this one test and then dropped: it is never saved or
  logged, so each test may go through Google again.
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
   `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `user_profile` and
   `calendar_link`.
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
-- Every account, with what is kept about it.
select u.id, u.name, u.email, u.created_at, a.account_id as google_id, p.preferred_name,
    c.calendar_id
from auth_user u
left join auth_account a on a.user_id = u.id
left join user_profile p on p.user_id = u.id
left join calendar_link c on c.user_id = u.id;

-- Removes an account, with its sessions, Google link, profile and calendar link.
delete from auth_user where email = 'someone@example.com';
```

To check that nothing extra is stored, `auth_account`'s token and scope columns, `auth_user.image`
and `auth_session`'s `ip_address` and `user_agent` should all be empty.

### Costs

Everything is on free tiers: Google sign-in costs nothing, the Neon free plan allows each
database 0.5 GB and a limited number of compute hours a month (it sleeps when unused, so a demo
stays well within it), and the Vercel Hobby plan covers the function. Nothing needs a paid plan
or an upgrade.

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
