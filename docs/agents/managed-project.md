# Rules for Robin's managed projects

Abodeo's own copy, imported by its CLAUDE.md. Copied from `project-starters/claude-home/managed-project.md` on 27 November 2026 and maintained here separately.

- When work on a ticket exposes a gap in `AGENTS.md`, `CLAUDE.md` or the files they link to, ask Robin before changing the rule. Once Robin says yes, commit the fix on that ticket's branch as a separate housekeeping commit that gives the reason, and mention it in the pull request description.
- When several open decisions all have a recommended default of "leave to investigation", ask one question first ("go through them, or leave them for investigation (recommended)?") and only walk through them one by one if Robin chooses to.
- Earlier ticket decisions are historical context, not defaults for new work. Reversing one carries no weight when evaluating options; consider its reasoning only where still relevant. Do not implement a reversal without Robin's approval: identify the earlier ticket, what it decided and why, and any real costs or risks (work, saved-data compatibility, documentation). Record the change in the new ticket, without editing or commenting on the old one. Never present a past decision as a technical constraint; do say when something is a real technical or saved-data limit.
- Don't-write mode: when Robin says "don't-write mode", write nothing to GitHub (tickets, comments, labels, pull requests) and discuss in chat only, until Robin says "exit don't-write mode". Then write the agreed changes in one batch, with one signed comment.
- Before putting a decision to Robin, check it against the project's scope rules (such as a prototype scope file under `docs/agents/`). Decide silently anything they already settle, and mention it in one line. Do not ask about it.

## Read when

- Robin reviews a pull request's code with you: `C:/dev/project-starters/claude-home/guides/pr-walkthrough.md`
- Robin says they are in, or going into, tweak mode: `C:/dev/project-starters/claude-home/guides/tweak-mode.md`
- Running a Codex review, or finishing a plan or an implementation: `C:/dev/project-starters/claude-home/guides/codex-review-handover.md`
