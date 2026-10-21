# Launch checklist: what only you can do, and what I do with it

About 10 minutes of your time. Never paste a key or password into chat: put it in the `.env` file at the root of the main checkout (it is gitignored). Tell me "keys are in" and I read them from the environment.

## 1. Merge (2 minutes)

```bash
cd C:/Users/ptula/OneDrive/Desktop/NORI
git merge launch/overnight        # or open a pull request on GitHub and merge there
```

I cannot merge into `main` or push; that stays yours.

## 2. Keys (5 minutes, any you have; each one unlocks a real test)

| Put in `.env` | Where to get it | What I then verify for real |
|---|---|---|
| `HOSTED_LLM_PROVIDER` / `HOSTED_LLM_BASE_URL` / `HOSTED_LLM_API_KEY` (or `ANTHROPIC_API_KEY`) | any provider in Settings, e.g. platform.openai.com/api-keys | model list, connection test, real tailoring on your resume, answers to form questions |
| `RESEND_API_KEY` + `EMAIL_FROM` **or** `SMTP_URL` + `EMAIL_FROM` | resend.com, or an SMTP login from your mail host | a real reset and confirmation email arrives and its links work |
| `DATABASE_URL` for a **scratch** Neon database or branch (not production) | neon.tech | both new migrations run, and the whole gate against real Postgres |
| `TELEGRAM_BOT_TOKEN` (optional) | message @BotFather in Telegram | link the bot, talk to the agent from your phone |
| `COMPOSIO_API_KEY`, `PARALLEL_API_KEY` (optional) | composio.dev, parallel.ai | inbox sync, tracker sheet, web job discovery |

Check what is read: `npm run doctor` prints "configured" or "BLOCKED" per area. "Configured" means the key is present; I then run the real call and report the result.

## 3. Four job links: DONE without you (see docs/LIVE-DRYRUN.md)

Nori picked one public posting per platform from the live feeds and dry-ran them; no links needed from you. The section below is kept for reference if you want to try a specific posting (`npm run dryrun:live <url>`).

### Original instructions

Paste one **public job posting URL** for each board, ideally a role you would never apply to:

- Greenhouse: `https://boards.greenhouse.io/<company>/jobs/<id>`
- Lever: `https://jobs.lever.co/<company>/<id>`
- Ashby: `https://jobs.ashbyhq.com/<company>/<id>`
- SmartRecruiters: `https://jobs.smartrecruiters.com/<Company>/<id>-<title>`

I run each driver as a **dry run**: open the form, fill it with a made-up test profile, take a screenshot, stop. Nothing is submitted (`ALLOW_REAL_SUBMIT` stays off) and no account is created.

## 4. Decisions

- Domain and hosting (the repo has a Dockerfile and `fly.toml`; the live site is currently an older build).
- Who reviews Privacy and Terms, and the contact email to show (`NEXT_PUBLIC_CONTACT_EMAIL`).
- Bring-your-own-key only (recommended) or a small free allowance on a key of yours.

## What I do once these are in

1. Run `npm run doctor`, then each real call: model list and test, tailoring on your resume with that model, one real email, Postgres migrations plus the gate against Neon, and the four dry runs.
2. Write down for each: **verified**, or the exact error. Nothing is called working unless it ran.
3. Fix what the real services show up, then rerun the gate.

## Deploy day

1. Staging first: deploy `main` to a throwaway app, sign up, run the journey by hand once.
2. Set `NODE_ENV=production`, `DATABASE_URL`, `WEB_URL`, `CREDENTIALS_KEY` (`openssl rand -base64 32`), `ARTIFACTS_DIR`, and your email settings. The API refuses to boot in production with an unsafe setup and says why.
3. Run the migrations against production only after the scratch run passed.
4. Keep `ALLOW_REAL_SUBMIT=false` until you have watched one full approval flow yourself.
