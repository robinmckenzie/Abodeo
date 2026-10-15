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

## Deployment

Abodeo is hosted on [Vercel](https://vercel.com/) at PRODUCTION_ADDRESS. Anyone
with that address can open it without a Vercel account. The other addresses
Vercel generates for each deployment ask for a Vercel login, because the project
uses Vercel's Standard Protection.

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
3. Keep the detected framework, React Router, and the default build settings.
   Add no environment variables. Selecting Deploy starts the first deployment.
4. In the project's settings, confirm that the production branch is `main`, the
   Node.js version is 24.x and Deployment Protection is Standard Protection.

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

1. In Vercel, confirm that the production deployment is the intended commit on
   `main`.
2. Open the production address in a private window that is not signed in to
   anything. The welcome screen appears without a sign-in prompt.
3. View the page source. The welcome text is in the HTML sent by the server.
4. In the browser's developer tools, the Console shows no errors and the
   Network tab shows the styles and scripts loaded without failures.
5. Open an address that does not exist, such as `/no-such-page`. The 404 page
   appears.

### Trying Vercel's build locally

To check Vercel's build without deploying, create `.vercel/project.json`
containing `{"projectId":"_","orgId":"_","settings":{"framework":"react-router"}}`
and run `npx vercel build`. The output goes to `.vercel/output`, which Git
ignores.
