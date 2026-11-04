# Git and pull requests

- While Robin tests an open pull request, changes Robin asks for go into it. Record each in a signed ticket comment and the PR description instead of editing the ticket's requirements, and validate and review them as usual.
- Name branches `<number>-<Title>`, such as `12-Add-search-filters`, or without the number for housekeeping work that has no ticket, such as `Add-ChatGPT-guidance`.
- Reference the ticket in commits, as `AD #12`. A pull request says `Closes #12`, so that merging it closes the ticket, and approval of the merge covers that. An abandoned ticket is closed as "not planned".
- Agreed work, and housekeeping work that was explicitly requested, may be committed, pushed on its own branch and opened as a pull request without asking. Merging, deploying, force-pushing and pushing to `main` each require explicit approval. Approving a merge or push into `main` also approves the production deployment it triggers.
- Before asking for approval to merge, bring the pull request description up to date with the handover summary.
- When Robin approves a merge, merge with the branch deleted on GitHub, as the Delete branch button does (`gh pr merge --merge --delete-branch`). Then tidy up without asking: fetch with `--prune`, switch to `main`, pull and delete the local branch. If the local branch is not fully merged, leave it and tell Robin.
