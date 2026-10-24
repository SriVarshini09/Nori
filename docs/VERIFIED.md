# What has actually run

The roadmap (`docs/ROADMAP.md`) calls a stage done only when its "proven when" lines ran for real. This file is the record: date, what ran, result. Nothing is listed here from a unit test alone.

## Stage 0: the deploy works for a stranger

| Date | Check | How | Result |
|---|---|---|---|
| 24 Oct 2026 | Live API has a model | `HOSTED_LLM_*` set on Fly (OpenAI, gpt-4.1 / gpt-4.1-mini). `/api/health` reports both tiers. A throwaway account's connection test returned a real completion in 1.5 s, then the account was deleted. | Proven |
| 24 Oct 2026 | Per-user daily token cap | PR 9 merged and deployed (Fly release v11). Settings on the live site shows "Model use today: 0 of 300,000 tokens". The refusal path is covered by `usage.test.ts` against a fake provider; a real user hitting the cap has not happened yet. | Proven (cap display); refusal in tests only |
| 24 Oct 2026 | Bring-your-own-key removed | PR 10 merged and deployed. Live Settings shows the read-only Model section and no key form; `user_credentials` dropped by migration 0010 on boot. | Proven |
| 24 Oct 2026 | Dashboard deploys from main | Vercel project `nori` imported from GitHub, root `apps/web`, env `API_URL` and `NEXT_PUBLIC_API_URL`. Domain `jobs.norinote.xyz` moved from the old account by TXT verification. Landing, public privacy page and the `/api` proxy answer from the new build. | Proven |
| 24 Oct 2026 | Telegram reaches the phone | `TELEGRAM_BOT_TOKEN` on Fly (bot @NoriNoteBot). Linking by one-time code shipped in PR 12 (Settings, Channels, Link Telegram). The owner pressed the button on the live site, sent the code from their phone, the bot replied "Linked" and answered `status`; the API shows the chat linked with `linkedWithCode`. | Proven |
| 24 Oct 2026 | Account email arrives | `RESEND_API_KEY` and `EMAIL_FROM=Nori <hello@norinote.xyz>` on Fly, domain verified in Resend (DKIM, two sending CNAMEs, DMARC at Spaceship). A real confirmation email was sent to the owner's Gmail, arrived, and its link set `emailVerifiedAt` on the live account. | Proven |

Still open in Stage 0: Sentry and an uptime monitor, the 7 Dependabot findings, a staging app on Fly, the phone walk-through of sign-up to an approved dry-run form.

Known problems seen on the way: the `PARALLEL_API_KEY` on Fly is invalid (every agent tick logs `Parallel search failed: 401`), so web discovery is off and only the ATS feeds run. Vercel suggests updating the `jobs` CNAME to its new value; the old one still works.

## Feature check (docs/FEATURE-CHECK.md), live site, 24 Oct 2026

| Row | Feature | Measured | Result |
|---|---|---|---|
| 4 | Pull a board (Greenhouse, vercel) | 8.5 s, 0 new (already known) | Pass |
| 5 | Paste a link | A board URL is refused with a clear message in 0.2 s; a single posting is still to try | Partial |
| 6 | Job detail | 1.1 s; requirements and match present; research off (Parallel key invalid) | Pass, research off |
| 7 | Agent status | 0.6 s; cap 10, 1 lane, dry run | Pass |
| 8 | Resume tailoring (Coinbase, Greenhouse) | 23 s to a rendered one-page resume; 14 changes, 13 traced to the graph; ATS 80; about 6,100 tokens | Pass (target 45 s) |
| 10 | Form filling (Coinbase) | First two runs failed: the board redirects to coinbase.com, 0 fields after 30 s. After PR 19 (Greenhouse's embedded form): 38 fields found, 27 filled, review reached in 47.5 s. 8 questions left for the person: Last Name (profile has no surname), Location (City) and School (typeaheads), Discipline, 4 Coinbase-specific yes/no questions | Pass on time (target 60 s); typeahead fixes in the next PR |
| 10 | Form filling (Databricks, Greenhouse) | Before PR 20: 8 questions left. After: 3 (School, a preferred-office pick, a conditional sanctions question). Degree and graduation date now come from the graph | Pass, improved |
| 17 | Tracker stats | 0.4 s, counts match | Pass |
| 19 | Companies search | 0.3 s | Pass |

Defects found and fixed on the way: the model wrote "Nori" as a Last Name the profile lacked (identity and contact fields are now never composed); School and Discipline typeaheads got no answer when the listed options did not match exactly (the name is now typed for the suggestions to match); a Places-style city field was given up on after 2.5 s (now waits longer and retries with the city alone). Each driver retry recomposes the free-text answers (about 1,500 tokens); caching them is still open.
