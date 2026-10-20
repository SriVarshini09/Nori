# Morning report

Branch `launch/overnight` (worktree `.claude/worktrees/launch`). Nothing is pushed, deployed or merged. `ALLOW_REAL_SUBMIT` was never turned on and no real application was submitted.

## Where it stands

`node scripts/gate.mjs` passes on this branch:

| Step | What it proves |
|---|---|
| TypeScript | the whole monorepo type-checks |
| Unit and API tests | engine, API, auth flows, resume exports, drivers (routing), env checks |
| Lint (web) | no lint errors |
| Web build, live mode | production build with `NEXT_PUBLIC_USE_MOCK=0` |
| Crawl | 67 pages (visitor and signed-in, desktop and 390 px phone), every link, 0 console/network errors, 0 axe-core WCAG A/AA violations, no horizontal overflow |
| Browser e2e (46 steps) | a real browser: signup, onboarding, resume studio, application review and edit, forgot password, email confirm, devices, password change, plus click-through of jobs (filters, drawer, apply), applications (answer then approve, skip), tracker, inbox and auto apply (cap, switches, lanes, run now, chat) |

## What changed, in the order you asked about

**Links and routes.** A crawler now visits every route and checks every link. Fixed: unknown ids returned HTTP 500 (now a friendly 404 page), `/api/artifacts/*` had no ownership check, a hydration error on empty states, and an onboarding bug that returned 400 when the salary was left blank.

**Resume.** A real system instead of a sample: library of resumes, section editor with live preview, 7 templates, font, accent, size, spacing, margins, Letter/A4, section reorder and hide, version history with restore, PDF / Word / text / JSON export, an ATS check that warns on two-column layouts, and editing of the tailored resume for a job before you approve it. Every template was rendered for four personas; no text is lost in the PDF and page limits hold.

**Backend.** Password reset, email confirmation, change password, signed-in devices (list and sign out), rate limits, security headers and CSP, boot-time env validation, hourly clean-up of expired sessions. The answer-then-approve 409 is fixed (approve waits up to 25 s for the resumed run). Lever, Ashby and SmartRecruiters drivers added. The tailoring prompt shrinks in three steps for 4k-context local models.

**Security.** A pasted job link can no longer make the server fetch internal addresses (loopback, private ranges, cloud metadata), including through redirects. An unreadable link now answers 422 with the reason instead of 500. One gap left: the model-test endpoint still calls a user-supplied base URL, because local Ollama needs that; restrict it before running a multi-tenant host.

**Job supply.** Nori now watches a curated registry of 186 company boards (104 Greenhouse, 54 Ashby, 20 Lever, 8 SmartRecruiters), each checked against its live public feed on the day it was built (about 33,000 open roles). The worker seeds them at start and re-reads each every 3 hours; boards a user follows or applied to are refreshed hourly by that user's agent tick. A new Companies page lets people search, follow and unfollow, and add any company by pasting its careers or job link (Nori finds the board behind it). Re-verify the list with `npx tsx scripts/verify-boards.mts` (edit `scripts/board-candidates.txt` to add candidates). Not covered: Workday, LinkedIn, Indeed and company-built career sites.

**Bring your own model.** Settings and onboarding now offer 12 providers (OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Together, Mistral, Cline, Ollama, LM Studio, or any OpenAI-compatible endpoint). Paste a key, load the provider's own model list, test the connection; keys are stored encrypted and never shown again. In production a model URL must be a public address (so the model settings cannot be used to reach internal services); single-user hosts that want Ollama or LM Studio on the same machine set `ALLOW_PRIVATE_MODEL_URLS=1`. Account email can now go through Resend or any SMTP server (`SMTP_URL` + `EMAIL_FROM`); the SMTP path is tested against a stand-in SMTP server, not a real mail provider. Plan and checklist: `docs/TOOLS.md`.

**Public side.** Landing page, Privacy, Terms, robots, sitemap, share image.

## What is NOT verified, and why

| Item | State |
|---|---|
| Real applications on Lever / Ashby / SmartRecruiters | Drivers route and open the application step (tested offline). Never run against a live posting. SmartRecruiters uses web components that the generic filler may not reach. Do a dry run on a posting you pick. |
| Hosted model, Composio (Gmail/Sheets/Calendar/Slack), Parallel, Telegram, WhatsApp, Resend email | **Blocked: needs keys.** Nothing ran against these. `npm run doctor` prints exactly which variable each one needs. |
| Reset / confirm emails | Without (`RESEND_API_KEY` or `SMTP_URL`) + `EMAIL_FROM` the links are written to the API log, not emailed. In production that means users cannot recover accounts. |
| Privacy and Terms text | Drafted from what the code actually does. Have someone qualified review before launch. Set `NEXT_PUBLIC_CONTACT_EMAIL` so they show a real contact (otherwise they point to the GitHub issues page). |
| Production Postgres | New migrations `0005_resume_docs` and `0006_auth_tokens` ran on PGlite only. Run them against a Neon copy first. |

## Things to know

- GitHub `origin/main` still has only the first commit and the live site is an older build. Nothing here is live until you push and deploy.
- The e2e and crawl use an offline stack (in-memory DB, fake form driver, no model). They prove the product's flows, not model quality.
- `.claude/worktrees/` is untracked in the main checkout; this worktree has its own `node_modules`.

## How to review

```bash
cd .claude/worktrees/launch
git log --oneline main..HEAD          # 18 commits, each one a step
npm run doctor                        # keys: configured vs blocked
node scripts/gate.mjs                 # everything above, ~4 minutes
```

Screenshots from the browser run are in `test-results/e2e/`, the crawl report in `test-results/crawl/report.md`.

## To launch

1. Review the diff and merge `launch/overnight` into `main` yourself.
2. Put the keys you have in the production environment (see `.env.example`; `docs/deploy.md`). Without `RESEND_API_KEY` and `EMAIL_FROM`, set them before opening signups.
3. Set `NODE_ENV=production`, `DATABASE_URL`, `WEB_URL`, `CREDENTIALS_KEY`, `ARTIFACTS_DIR`. The API refuses to boot in production with an unsafe setup and says why.
4. Run a dry run of one real posting per ATS before trusting the drivers.
5. Keep `ALLOW_REAL_SUBMIT=false` until you have watched at least one full approval flow yourself.
