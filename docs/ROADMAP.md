# Nori product roadmap: what to build and how each piece is proven

Written 23 October 2026. Goal: not a demo. A product a stranger can sign up for, that finds jobs everywhere, tailors honestly, applies for real, reads its own mail, and reaches the person on their phone.

Stages are in build order. Each stage leaves a usable product. A stage is **done** only when every line under "Proven when" has actually run; nothing is called working from a unit test alone.

Stack decisions (23 and 24 Oct): keep home-built auth, Neon Postgres, Hono API, Next.js web, Fly + Vercel hosting. The model is part of the product: every account runs on Nori's hosted key with a daily allowance, and bring-your-own-key was removed (subscription only, no keys to paste). Add Resend (send and inbound), Browserbase (hosted browser with live view), Exa and context.dev (discovery), Web Push, Twilio SMS, Stripe, Sentry. Not switching to Supabase, Clerk, Omnara runtime, Freestyle or Unikraft.

## What you must provide (I cannot create these)

| Account or key | Needed by stage | Where |
|---|---|---|
| Fly, Vercel, Neon access (already exist) | 0 | fly.io, vercel.com, neon.tech |
| A model key for the hosted default (`HOSTED_LLM_*`) | 0 | the OpenAI key already verified, or any preset |
| Resend API key and DNS access to norinote.xyz | 0 (send), 3 (inbound) | resend.com, your DNS host |
| Telegram bot token | 0 | @BotFather |
| Sentry DSN, Better Stack uptime monitor | 0 | sentry.io, betterstack.com |
| Google OAuth client id and secret | 1 | console.cloud.google.com |
| Browserbase API key and project id | 2 | browserbase.com |
| context.dev API key, Exa API key | 4 | context.dev, exa.ai (hackathon credits) |
| Stripe test keys, then live | 6 | stripe.com (hackathon credits) |
| Twilio account, number, messaging service | 8 | twilio.com |

Put keys in `.env` at the repo root (gitignored) or in Fly secrets. Never paste them in chat.

## Stage 0: the deploy works for a stranger

**Build**
- Set `HOSTED_LLM_*` on Fly so every account has a model (done 24 Oct). Per-user daily token cap with a visible "this run used about N tokens" line (done, PR 9). Bring-your-own-key removed (PR 10).
- Resend for account email (`RESEND_API_KEY`, `EMAIL_FROM`), domain verified.
- Telegram bot token on Fly; bot handle shown on Auto apply and in onboarding's integrations step.
- Sentry in API and web; uptime monitor on `/api/health` and `/login`; Neon point-in-time restore confirmed on.
- Fix the 7 Dependabot findings (2 critical).
- Staging app on Fly (`jobgraph-api-staging`) that every stage deploys to first.

**Proven when**
- From a phone that has never seen the site: sign up, confirmation email arrives within 1 minute, upload a resume, graph appears, open a job, apply, tailored diff shows model-written changes (not the heuristic), form review shows the filled form, approve (dry run).
- Password reset email arrives and its link works.
- `/api/health` shows `llm` not `none`, `telegram: true`.
- Link Telegram from Settings, text `status`, get a reply.
- Sentry receives a deliberate test error from both apps. Uptime monitor alerts your email when staging is stopped on purpose.
- `npm run gate` green; `npm audit --omit=dev` shows no critical.

## Stage 1: it reaches your phone

**Build**
- PWA: manifest, icons, service worker, "Add to Home Screen" prompt on iPhone and Android.
- Web Push: VAPID keys, `push_subscriptions` table, subscribe from Settings and from the first review request. Sent on: resume ready, form ready, needs you, submitted, interview or offer email, agent tick summary. Notification preferences per event.
- Google sign-in (OAuth) next to email and password; links to an existing account by email.
- Telegram and WhatsApp messages already carry Approve and Skip; push notifications deep-link to the application page with the same buttons.

**Proven when**
- On an iPhone with the site added to the home screen, lock the phone, run the agent from another device: a push arrives, tapping it opens the application, Approve works.
- Same on Android Chrome.
- Sign in with Google creates an account on first use and signs into the same account on second use.
- Notification turned off in preferences is not sent (checked in the event log).

## Stage 2: it applies for real

**Build**
- Browser on Browserbase: drivers connect over CDP when `BROWSERBASE_API_KEY` is set, local Chromium otherwise. Session per application, recording kept, artifacts still saved under the application.
- **Hand-off in the browser:** when a CAPTCHA, login wall or unknown blocker appears, the application goes to `needs_user` with a live-view link. The person taps the link on their phone, solves it, taps "Done" in Nori; the driver resumes from where it stopped. Timeout 15 minutes, then the application waits with the reason.
- Real submission on Greenhouse: `ALLOW_REAL_SUBMIT=true` on production, confirmation page detected, confirmation email matched to the application (stage 3 makes this automatic).
- Receipt grouped by form section with field counts, radios shown selected or not, "Selected from N options" for dropdowns, tabs Form, Resume, Cover, Job.
- Cover letter when the form asks for one, from the graph, with the same provenance rule.
- Escape hatches on the review page: "Use original resume", chat box to request edits routed through the provenance validator.

**Proven when**
- Dry runs on Browserbase on one live posting each for Greenhouse, Lever, Ashby and SmartRecruiters produce the same or better fill counts than `docs/LIVE-DRYRUN.md`.
- A Lever posting hits hCaptcha, the phone receives the hand-off, you solve it on the phone, the run resumes and reaches form review. Recorded session shows the whole thing.
- **One real Greenhouse application you actually want to send**, approved by you, submitted, confirmation email received, status `submitted`, receipt complete. This is the first real submission in the product's history; do it only after the dry runs pass.
- Autopilot sends one Greenhouse application on its own after the trust ladder is met, with all 11 checks logged.
- A SmartRecruiters posting is handed off with the bot-block reason, not reported as "no form".

## Stage 3: it reads its own mail

**Build**
- Resend Inbound on `mail.norinote.xyz` (MX record). Each user gets `firstname-xxxx@mail.norinote.xyz`, shown in Settings and on every receipt as "Applied using".
- Webhook `/api/webhooks/resend` with signature check, writes `inbox_messages`, runs the existing classifier (verification code, confirmation, recruiter, interview, rejection, offer, assessment, reminder) and links the message to the application by employer and time.
- The owned address becomes the applicant email on forms by default; the person can choose their real one instead.
- Verification codes: the runner's `awaiting_code` wait reads the owned inbox first, Gmail second.
- Replies forwarded to the person's real email, with a Reply button in Nori's inbox that sends from the owned address.
- Gmail through Composio stays as the optional path; add IMAP with an app password for self-hosters (TOOLS C1) after.

**Proven when**
- Send a mail to your owned address from any account: it shows in Nori's inbox within 30 seconds, classified.
- A forged verification-code email to the owned address during an `awaiting_code` wait lets the run continue (end to end against a form that asks for a code, or the fixture form with a code step).
- The Greenhouse confirmation from stage 2 lands under the application automatically.
- A rejection email moves the application to `rejected` on the tracker; an interview email creates the calendar hold when Calendar is connected.
- Spam sent to the address does not create applications or move statuses.

## Stage 4: it finds jobs everywhere

**Build**
- Company sites: "Add a company by careers link" falls back to context.dev scrape when no known ATS is found. Read JobPosting markup first, the model second. Store `source: "career_page"`.
- context.dev monitors on every followed company page; the change webhook queues a re-read instead of polling.
- Exa search adapter behind the `SearchProvider` interface (TOOLS B1): natural-language lane queries over X posts, Hacker News "Who is hiring", Wellfound, YC jobs, and public LinkedIn job pages. Never logs in anywhere. LinkedIn only through public job URLs returned by search.
- Dedupe: same apply URL, or same company plus normalized title within 30 days, becomes one job with several sources. Job drawer shows "found on X post by @handle" or "company careers page, via monitor".
- Company research through Exa plus the user's model with citations; Parallel stays as an optional adapter.
- Freshness: a posting whose apply page returns 404 is marked closed and never queued.

**Proven when**
- Paste the careers links of 10 companies that are not on Greenhouse, Lever, Ashby or SmartRecruiters (include Ross and Burlington from `docs/JOB-COVERAGE.md`): at least 7 produce correct jobs with title, location and apply link.
- Add a monitor to one careers page, post nothing, confirm zero false alerts in 24 hours; a page that does change produces exactly one new job.
- An Exa lane query returns at least 10 postings from at least 3 non-ATS sources, each opening to a real posting; no duplicates against the feed for the same company.
- Research for 5 companies returns stage, headcount and recent news with working citations.
- Agent tick on an account with lanes finds and scores jobs from all sources, with the source visible in the activity feed.

## Stage 5: Workday and the big employers

**Build**
- Workday driver: structured "My Experience" filling (roles, education with degree picker, skills one per entry), multi-page flow, account creation per employer with a generated password in an encrypted `ats_accounts` table, shown on the receipt. Account creation only after the person approved the form.
- iCIMS and Oracle after Workday, same account vault.
- Workday public search endpoint as a feed for followed companies (verify terms first).

**Proven when**
- Dry runs on 3 Workday postings from different employers reach the review page with the work history filled structurally and a screenshot of each page.
- One real Workday application you want to send: account created, form submitted, confirmation email in the owned inbox, password visible on the receipt.
- A second application to the same employer reuses the account.

## Stage 6: plans and billing

**Build**
- Stripe Checkout and Customer Portal. Free: 3 applications a day, 1 resume, 2 lanes, the standard daily model allowance. Pro: 20 a day, resume library, unlimited lanes, Autopilot, a larger model allowance. Since Nori is subscription only, this stage can move up to right after stage 2 so there is something to sell before discovery and Workday.
- `plan` on `users`, set by the webhook; cap enforcement in the agent gate; counter on the dashboard ("12 applications left today").
- Referral: share link, both sides get extra applications.

**Proven when**
- Test-mode purchase raises the cap immediately; cancel in the portal lowers it at period end; webhook signature failures are rejected; the counter is right after each application.

## Stage 7: outreach

**Build**
- On every application and job: "People at <company>" from Exa's people index, filtered to the team or role. Drafted note from the graph (shared skills, a real result), never an invented connection.
- Send through Gmail when connected, else copy; tracked in an `outreach` table with follow-up reminders at 5 and 12 days.

**Proven when**
- For 5 jobs, at least 3 relevant people each with current title and company; every draft passes the provenance validator; a sent note shows in the tracker with its reminder.

## Stage 8: SMS and other channels

**Build**
- Twilio SMS channel adapter (two-way, same commands as Telegram). iMessage is not possible without a Mac bridge; SMS is the substitute. Slack and Discord through the existing adapter interface if asked.

**Proven when**
- Text `status` and `approve 1` from a phone number linked in Settings; both work; unknown numbers are ignored.

## Stage 9: the Tsenta leftovers and quality

- Tracker stages Ghosted (no reply in 14 days) and Assessment; email count per card.
- Onboarding defaults: in-person OK, start immediately, has transport, needs accommodations, prior employee, government ties; salary sanity check against the role level.
- Resume replace asks "replace graph" or "merge" (backlog 4).
- Profile completeness meter; projects with links feeding graph nodes.
- OCR for scanned PDFs.
- Per-user artifact retention and deletion with the account.

**Proven when** each has a unit test and shows up in the crawl and browser journey.

## Testing that runs on every stage

- `npm run gate`: typecheck, unit and API tests, PostgreSQL 17, lint, production build, crawl of every page on desktop and phone (0 console errors, 0 WCAG A/AA violations), 46-step browser journey. Extend the journey with each stage's flow.
- Staging deploy first, then the phone walk-through by a person, then production.
- A written note per stage in `docs/VERIFIED.md`: date, what ran, result, or the exact error. Nothing moves to the next stage with an open "not verified" on a "proven when" line.

## Saturday 24 October (Agent Builders Hackathon)

Build day is 11:00 to 17:30. The organizers confirmed by email that an existing project may be brought. What fits in the day and also scores with the judges: all of stage 0, stage 1's PWA and push, stage 2's Browserbase connection and live-view hand-off, and stage 4's context.dev career-page reader. Submit on Devpost with the live link, an open sign-up, and a test login.

Demo for the judges: sign up on a phone, upload a resume, lanes, Run now, watch the activity feed, open the application, diff with provenance, Recruiter's view, filled form, approve; a Lever CAPTCHA handed to the phone and solved; paste any company's careers link and watch jobs appear; text the Telegram bot.
