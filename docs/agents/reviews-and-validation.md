# Reviews and validation

## Codex review rounds

- Run Codex non-interactively and read-only using `codex exec` on the relevant material. A draft ticket, the plan, the implementation and changes made during pull request testing are separate reviews. Fix findings within the ticket's scope.
- Review a draft ticket or a plan only when the change is complex, ambiguous or high-risk. The implementation review is mandatory (see below).
- Use one round by default. Run a second round only when substantial findings were fixed and verification is warranted. Never exceed two rounds per review.
- Record each round's findings and fixes, the overall change, any findings left open, and whether an optional review was skipped. Tell Robin the outcome and what remains to decide. If Codex cannot be run, say so and provide Robin with the prompt instead.

## Validation

- For code changes, run `npm run build`, `npm run typecheck`, `npm run lint` and `npm test`. Report failures and any checks that could not run.
- Add or update regression tests for changed logic where useful, but not for development-only tools, such as tuning panels, unless Robin asks.
- For changes to a user interface, verify the affected behaviour in the running application at one desktop size, adding sizes only where the change depends on window width. For development-only tools, a quick look is enough. Phone and tablet are out of scope until Robin brings them back.
- Implementing a ticket includes one mandatory independent review after committing, covering the commit and ticket text. Record the review in the pull request description.
- When handing over, summarise the resulting behaviour, and state what was verified, what was not, and why. Do not report something as verified if it could not be checked reliably.
