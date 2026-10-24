# Feature check: every feature, on the live site, timed

Run against https://jobs.norinote.xyz with a real account. A row passes only when it was done on the live site and the time was measured. Record the result and the date in `docs/VERIFIED.md`. Speed targets come from what a person will tolerate and from the Tsenta benchmark (tailor plus fill plus submit in about a minute).

| # | Feature | How to check | Pass when | Speed target |
|---|---|---|---|---|
| 1 | Sign up and confirm | New email on a phone, sign up, open the confirmation email, click | Account verified, lands in onboarding | Email within 60 s |
| 2 | Onboarding | Resume upload (PDF and Word), contact, authorization, screening, preferences, finish | Every step saves; graph has roles, skills, metrics with source lines | Resume read in under 30 s |
| 3 | Career graph | Open /graph, add a fact in plain text, delete a node, export JSON | Fact becomes nodes; export downloads | Fact added in under 10 s |
| 4 | Pull jobs from ATS feeds | Companies: follow 3 boards (Greenhouse, Lever, Ashby); Jobs: refresh | New jobs appear with title, location, apply link, match score | First jobs within 60 s of following |
| 5 | Pull jobs by link | Paste a Greenhouse job URL and a company careers URL on Companies | Job created, or a clear reason why not | Under 15 s |
| 6 | Job detail | Open a job: requirements, match explanation, gaps, research | All four sections render; research has citations or says it is off | Page under 3 s |
| 7 | Lanes and Run now | Auto apply: 2 lanes, cap 3, Run now | Activity feed shows found, scored, queued, skipped with reasons | Cycle under 2 min |
| 8 | Resume tailoring | Apply to a job; watch the log | Diff with provenance, ATS score, Recruiter's view; no invented claims | Tailoring under 45 s |
| 9 | Resume review edits | Edit a bullet, "use original" escape hatch, approve | Edits kept; approve moves to filling | Instant |
| 10 | Form filling (dry run) | After resume approval | Form review with every field, autoanswers marked, screenshot | Fill under 60 s |
| 11 | Answer a pending question then approve | Answer, approve straight away | No 409; run continues | Instant |
| 12 | Submission | Greenhouse posting the owner really wants, `ALLOW_REAL_SUBMIT=true` | Status submitted, confirmation page detected, confirmation email in inbox | Submit under 30 s after approve |
| 13 | CAPTCHA hand-off | A Lever or Ashby posting | Application goes to needs_user with a clear reason (hand-off link once Browserbase lands) | Under 60 s to hand off |
| 14 | Autopilot | Turn on Safe, trust ladder met | One Greenhouse application sent without asking; 11 checks logged | Same as 8 + 10 + 12 |
| 15 | Telegram | `status`, `apply 2`, `skip 1`, `approve 1` | Correct replies and actions; review requests arrive as messages | Reply under 5 s |
| 16 | Inbox | Send a recruiter-style email to the connected mailbox; sync | Classified, linked to the application, tracker moves | Within one sync |
| 17 | Tracker | Board and stats after the above | Counts match applications | Page under 3 s |
| 18 | Resume studio | New resume, edit, change template, export PDF and Word, version restore | All work; PDF keeps one page | Export under 10 s |
| 19 | Settings | Model usage line, channels, integrations, password change, devices, delete account (on a throwaway) | Each works | Instant |
| 20 | Companion and MCP | Tray app status; MCP `status` tool with bearer token | Both answer | Under 5 s |

## Speed: where time goes and what to do about it

Tailoring and filling are the two long steps. Measured on the live site they must stay under the targets above with the hosted model (gpt-4.1). Levers, in order of effect:

1. Use the bulk model (gpt-4.1-mini) for requirement extraction and scoring, the quality model only for the bullets and the summary. Check `packages/core/src/tailor` and `runner` for calls that use quality where bulk would do.
2. Run the independent model calls of a tailoring pass in parallel (requirements, summary, bullets per role) instead of in sequence.
3. Shrink prompts: send only the roles and bullets relevant to the job, not the whole graph.
4. Cache requirement extraction per job (it is already stored on `jobs.requirements`; make sure a second applicant does not redo it).
5. Form filling: Browserbase cold start and page loads dominate; keep the session warm per run and skip screenshots except at review.
6. Show progress in the log every few seconds so a 40-second wait does not look like a hang.

Any row that fails or misses its target gets a fix on its own branch, then the row is rerun.
