# Abodeo

Abodeo is an app for managing tasks and projects around the home.

- Use hyphens (`-`) instead of em dashes in prose, documentation, and comments.
- Refer to Robin as "Robin", not "the owner", in tickets, documentation and other written output.

## Read when

- Starting (including starting a stage of a ticket), changing or closing a ticket, or acting in GitHub: [tickets](docs/agents/tickets.md)
- Writing or drafting a ticket: [ticket writing](docs/agents/ticket-writing.md)
- Branching, committing, opening or merging a pull request: [git and PRs](docs/agents/git-and-prs.md)
- Planning, building or reviewing anything (what not to cover): [prototype scope](docs/agents/prototype-scope.md)
- Writing code or handling credentials: [code conventions](docs/agents/code-conventions.md)
- Touching the database, `db/` or README queries: [saved data](docs/agents/saved-data.md)
- Reviewing, validating or handing over: [reviews and validation](docs/agents/reviews-and-validation.md)
- Planning work that may relate to a known idea or tech debt: [future considerations](docs/agents/future-considerations.md)

## Agent skills

### Issue tracker

GitHub Issues on robinmckenzie/Abodeo, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Not used. The ticket stage labels (`STUB`, `DRAFT`, `Agreed`) do that job; see [tickets](docs/agents/tickets.md).

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
