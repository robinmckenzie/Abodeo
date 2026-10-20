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
- There are no environment variables.
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
