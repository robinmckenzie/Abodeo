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

- [Node.js](https://nodejs.org/) 22.22 or later, which includes npm.

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
| `npm start` | Serves the production build (run `npm run build` first). |
| `npm run typecheck` | Checks the TypeScript types. |
| `npm run lint` | Checks the code with ESLint. |
| `npm test` | Runs the tests once with Vitest. |
