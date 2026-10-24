On 24-Oct-2026, Codex analysed Abodeo, Andrew and Robin’s WhatsApp chat and the NCS/Efficio PDF to suggest seven home-project features, prioritising useful, simple API integrations.

**I would start with task-level assignment. Weather guidance is the strongest new API opportunity**, because it could help with Andrew’s actual outdoor projects without requiring another account connection.

I read `AGENTS.md`, `README.md`, `FUTURE_CONSIDERATIONS.md`, the application source and tests, the complete [WhatsApp chat](</C:/Users/robin/Downloads/Andrew Dawson - WhatsApp 14-10-2026 to 23-10-2026/Andrew WhatsApp chat.md>) and the four-page [starting PDF](</C:/Users/robin/Downloads/NCS and Efficio delivery projects.pdf>). I also inspected existing projects and the image viewer in the working local app, without editing data.

Live GitHub checks found no open PRs, and clean `main` matches GitHub at `9a4cd29`. I excluded features already represented by contractor work, orders, shop search, dictation, people management and appointments, plus the planned text-only journal. Gmail import remains ruled out, and phone/tablet work remains outside scope. No files or issues were changed.

Andrew’s **reported problems** concern unresolved household repairs, several trades working at different times, and purchases spread across shops. His **explicit outstanding requests** include separately assigned tasks and multiple photos on tasks. The other recommendations below are **inferences**, guided by that evidence. The PDF contributes ideas about prerequisites, evidence and costs; its enterprise procurement proposals are background.

1. **Assign individual tasks to people**

   **Problem:** A project-level assignee cannot describe work divided between the householder and different tradespeople.

   **Why it fits:** On **16 October at 12:28**, Andrew explicitly said, “keep each task assigned separately”. His earlier DIY examples also distinguish his own work from contractors’ work. Currently, [tasks.ts](/C:/dev/Abodeo/app/projects/tasks.ts:4) contains only identity, title and completion; assignment belongs to the project.

   **Overlap and question:** [AD #61](https://github.com/robinmckenzie/Abodeo/issues/61) manages the available people, but does not add task assignment. This would use that list without adding accounts or invitations. Decide whether tasks inherit the project’s assignee until someone changes them. Other task fields were deliberately outside AD #33’s initial scope, so this would be an explicit extension.

2. **Show weather windows for outdoor tasks**

   **Problem:** People doing decking, garden construction or outdoor painting need to choose a suitable day.

   **Why it fits:** This is **inferred** from Andrew’s raised beds and greenhouse examples on **15 October**, and decking project on **16 October**. Showing relevant conditions alongside outdoor tasks would serve a concrete household decision. It is distinct from [AD #65’s appointments](https://github.com/robinmckenzie/Abodeo/issues/65).

   **API assessment:** Open-Meteo provides rain, temperature and wind forecasts by coordinates. Technical integration effort is **low**: read-only requests, with no user OAuth or API key on the free non-commercial service. Free limits include 10,000 calls/day and 300,000/month; attribution is required. Paid access uses an application key. Abodeo’s stated personal use makes the free service worth considering. [Forecast documentation](https://open-meteo.com/en/docs), [pricing](https://open-meteo.com/en/pricing).

   **Privacy and reliability:** Send a user-chosen town location rather than an exact home address, and no project text. Logs may contain coordinates and IP addresses for up to 90 days. Free service has no uptime guarantee, and Vercel’s shared infrastructure can encounter limits early. Forecasts should remain advisory, show freshness, and leave task planning usable during outages. The provider separately classes promotional activity as commercial, so clarify eligibility if a public demo falls into that category. [Terms and privacy](https://open-meteo.com/en/terms).

   **Product question:** Begin with forecast information or suggest suitable windows? The latter needs user-chosen criteria rather than assumptions about what weather a job requires.

3. **Show task prerequisites and blocked work**

   **Problem:** An ordered checklist does not explain which tasks can start or why another is waiting.

   **Why it fits:** Andrew’s **16 October** decking example has a clear sequence: remove wood, prepare the surface, then lay tiles. Dependency tracking is an **inference** from that example. The existing task model supports reordering, but no prerequisites. The PDF’s **page 2**, discussing clear next actions and exceptions, supports this household adaptation.

   **Overlap and question:** [AD #7, Track contractor work](https://github.com/robinmckenzie/Abodeo/issues/7), remains a title-only STUB, so its eventual boundaries are uncertain. Keep this proposal specifically about task readiness, rather than basic contractor records or automatic scheduling. Decide whether prerequisites initially stay within one project and whether users can override a blocked state.

4. **Attach multiple photos to individual tasks**

   **Problem:** A picture of a particular fitting, defect or completed step can lose its context in a project-wide image stream.

   **Why it fits:** Andrew explicitly supported task-level images on **21 October at 16:05**, and multiple task pictures at **16:35**. He separately said the journal belonged at project level because individual tasks lacked the same journey.

   [AD #48](https://github.com/robinmckenzie/Abodeo/issues/48) delivered project images and their timeline. A compact collection attached to a task would address the remaining request without creating another journal.

   **Overlap and question:** Preserve the agreed JPEG/JPG and PNG formats and existing privacy boundaries. Decide whether task photos also appear in the project journal, and whether deleting a task removes its photos or leaves them with the project.

5. **Keep receipts, manuals and quotations with projects**

   **Problem:** Household projects generate documents that users need again when checking a quotation, assembling something, claiming a warranty or arranging another repair.

   **Why it fits:** This is **inferred**, not an explicit Andrew request. It follows from his purchases across several shops and phone-organised contractors. Abodeo currently accepts image attachments, as shown by the [image picker](/C:/dev/Abodeo/app/projects/project-images.tsx:216). The PDF’s **pages 2–4** emphasise missing documents and supporting evidence; household receipts and instructions are a useful translation.

   **Overlap and question:** [AD #8’s order tracking](https://github.com/robinmckenzie/Abodeo/issues/8) may eventually include receipts, so avoid separate copies. Decide whether users upload documents or retain links, and which formats are supported. Treat documents as a separate capability, preserving the existing photo-format decision and Gmail exclusion.

6. **Show project budgets and actual spending**

   **Problem:** Buying materials and paying trades separately makes a household project’s total cost difficult to judge.

   **Why it fits:** This is **inferred**; Andrew did not report overspending or request budgeting. His multi-trade, multi-shop situation nevertheless provides a practical use case. The current [project fields](/C:/dev/Abodeo/app/projects/projects.ts:18) contain no financial information. The PDF’s **page 2** stresses total cost, while **pages 3–4** distinguish financial expectations from outcomes.

   **Overlap and question:** The new capability is comparing an overall household project budget with spending. Individual purchases and contractor charges belong alongside AD #8 and AD #7 rather than being recreated here. Decide whether totals include paid expenses only or also accepted quotations, and how deposits avoid being counted twice. Multiple currencies need a separate decision.

7. **Repeat household maintenance tasks**

   **Problem:** Some household work needs doing again after completion, rather than disappearing permanently from attention.

   **Why it fits:** This is the **least directly supported inference**. Andrew described repairs and garden work, but did not request recurrence. Repeating tasks could extend the existing checklist to seasonal garden care, gutter cleaning or equipment servicing. The PDF’s expiry-triggered follow-up work on **page 3** offers inspiration, without importing business contract management.

   **Overlap and question:** Recurrence is distinct from AD #65’s appointments: completing maintenance could produce the next task without creating a Calendar event or requiring background Google access. Decide whether the next occurrence follows a fixed schedule or the previous completion, and what happens when an occurrence is missed. Confirm demand before prioritising this above the more directly evidenced features.

**ChatGPT then analysed the suggestions above, and gave this analysis:**

Overall, Codex’s analysis is thoughtful: it distinguishes Andrew’s explicit requests from its own inferences, checks ideas against the existing backlog, and keeps the workplace PDF in perspective. My main adjustment would be to rank ideas by evidence and fit for Abodeo, rather than by API novelty.

1. **Task-level assignment - strongest.** Andrew explicitly asked to assign tasks separately, and Abodeo already has a people list in progress. I’d treat this as a follow-on to [AD #61](https://github.com/robinmckenzie/Abodeo/issues/61), and decide how it should work with that list before drafting requirements.

2. **Photos on tasks - strong.** This is also an explicit request, and it builds on the project photo feature in [AD #48](https://github.com/robinmckenzie/Abodeo/issues/48). Keep task photos distinct from the project-wide journal, and clarify what happens to them when a task is deleted.

3. **Task prerequisites - promising.** Andrew’s decking example gives a concrete sequence, so this has clearer user evidence than most inferred suggestions. I’d keep the first version simple; dependencies can get complicated if tasks can block each other in cycles.

4. **Weather guidance - worth exploring, with a caveat.** It’s a good API candidate for outdoor work, but less directly supported than assignments and task photos. Open-Meteo’s free service is limited to non-commercial use; its terms include promotional activity as commercial, which may matter if Abodeo is used as a job-search demo. Paid plans allow commercial use, but that could undermine the “simple and useful” case. [Open-Meteo terms](https://open-meteo.com/en/terms) · [pricing](https://open-meteo.com/en/pricing)

5. **Project documents - useful, but define the job carefully.** Receipts and manuals could help, though this is an inference from Andrew’s situation. Decide whether documents belong to an order, a contractor, or the project generally. Supporting PDFs would also be a separate capability from the current JPEG/PNG project images.

6. **Budgets and spending - plausible but premature.** Andrew’s purchases across shops make it relevant, but he hasn’t reported a budgeting problem. Since [AD #8](https://github.com/robinmckenzie/Abodeo/issues/8) and [AD #7](https://github.com/robinmckenzie/Abodeo/issues/7) are still STUBs for orders and contractor work, I’d first see what cost information those features need.

7. **Recurring maintenance - weakest for now.** It may suit a broader home-maintenance use case, but the chat doesn’t establish demand, and recurrence adds scheduling questions. I’d validate the need before turning it into a ticket.

My suggested first group to discuss is **task assignment, task photos, and prerequisites**. Keep weather on the shortlist as the API showcase idea, conditional on confirming that its use and cost fit Abodeo’s intended public demo.

**Claude Code then analysed this file, and gave this response**

My view is that ChatGPT's ranking is the better one, and I'd start with assignment and task photos.

**Where I agree**

- **Evidence first.** Assignment (16 Oct) and task photos (21 Oct) are the only two features Andrew asked for outright. They are also small extensions of work you already have, AD #61 (the people list) and AD #48 (project images).
- **Weather is a showcase, not a need.** Codex's "strongest API opportunity" is true only if the goal is demonstrating an API. Andrew's chat doesn't show weather as a pain point.
- **Budgets, documents and recurrence can wait.** Budgets should follow AD #8 and AD #7, which are still stubs. Recurrence has no evidence behind it.

**Where I'd adjust**

- **Weather's terms.** Both analyses flag the non-commercial restriction. If Abodeo is a job-search demo, that is a real eligibility problem, not a footnote. I'd keep weather on the shortlist and resolve the terms question first. I haven't checked Open-Meteo's terms myself, so I'm relying on their quotes.
- **Photos on tasks may be the smaller job.** It reuses the AD #48 upload and viewer code, and the main design decision is what happens to the photos when a task is deleted. Assignment has more open questions: inheriting the project assignee, and how it interacts with AD #61.
- **Prerequisites are the biggest build.** They need a data-model change, cycle prevention, a blocked-state UI and an override rule. Andrew's decking sequence is an example, not a request. I'd run it as a separate ticket after the first two, and not bundle it.
- **Task features share one data change.** Assignment, photos and prerequisites all add fields or tables to tasks. Sequencing them avoids three separate saved-data compatibility exercises, which `AGENTS.md` requires you to handle.
