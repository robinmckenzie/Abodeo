# Ticket writing

- From DRAFT onwards, the ticket's body has the sections User story, Requirements and Acceptance criteria, in that order. A ticket that is large enough to need it also has a final Stages section.
- Stages split a ticket into tracer bullets: thin, complete paths through every layer, each demonstrable on its own. Number them in the order they are done, say what each is blocked by, and give each a demo and an observation that would show it failed. Put preparatory refactoring first. Do not name files or line numbers. Do not make a stage a single layer, such as only the database or only the screen. When a stage relies on something that already exists, check it in the code or the saved data before writing it into the ticket. If it cannot be checked, write it as an assumption for Robin to confirm.
- Findings and discussion go in comments. Do not wrap lines, because GitHub shows every line break in an issue.
- Describe the problem and the behaviour wanted, not how to build it. Put a constraint in Requirements only when it is genuinely required, such as one imposed by an external API, security or saved-data compatibility.
- When a ticket depends on another that is not yet done, say so in the body and also set GitHub's blocked-by link, so that the order shows on the issue and an agent can check it. Priority labels do not record an order. A parent ticket groups related tickets and does not imply an order.
- When asked to stub or draft a ticket, write only that ticket. Do not modify files or other tickets unless explicitly authorised.
- A draft ticket needs to be coherent enough to be agreed, not to settle every implementation detail. Distinguish product decisions needed before agreement, provisional or tunable defaults, questions for investigation, and product questions that investigation exposes, which are brought back for a decision.
- After drafting or substantially revising a DRAFT ticket, review the ticket and relevant code only when the change is complex, ambiguous or high-risk. Record any review in a signed ticket comment.
- When handing over a drafted or revised ticket for review, separately summarise:
    - what it leaves out of scope, whether stated explicitly or left out by omission;
    - any assumptions made while drafting;
    - earlier decisions or existing behaviour it changes, naming the ticket and what it decided, and any conflict with `AGENTS.md` or `docs/agents/`.
