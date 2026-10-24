# Agent Builders Hackathon, Saturday 24 October 2026

Omnara, 639 Howard St, San Francisco. Doors 10:00, kickoff 10:30, building 11:00 to 17:30, top demos 18:00, awards 18:45.
Luma: https://luma.com/poqk5sgn. Devpost: https://agent-builders-hackathon.devpost.com/

The written rules say existing projects are not allowed. The organizers were emailed on 23 October and replied that old projects may be brought. Say so in one line of the Devpost write-up.

## What the judges score

| Criterion | What it means for Nori |
|---|---|
| Production-ready | A judge signs up on their phone, uploads a resume, and gets a tailored application without help. It stays up until 18:45 with the laptop closed. |
| Agentic use | The agent finds jobs, tailors, fills forms and sends Autopilot applications in the background, and the judge can watch it and talk to it. |
| Creativity | The career graph, provenance on every line, the Recruiter's view, the trust ladder. |

Submission (by 17:30): live link under "Try it out", a test login or open sign-up, and a short description of what it does, who it is for, how it uses agents, and what to try first.

## State of the live deploy on the evening of 23 October

- `https://api.norinote.xyz/api/health` answers. **`llm: none`**: the hosted API has no model configured, so a judge who signs up gets rule-based tailoring only. This is the first thing to fix.
- Parallel is connected. Composio and Telegram are not. `ALLOW_REAL_SUBMIT` is off (forms are filled, nothing is sent).
- `https://jobs.norinote.xyz` redirects to `/login`, which loads.

## Plan, in priority order

### Track A: judge-ready (do first, before any new feature)

1. Set `HOSTED_LLM_*` on the API host so every account has a model. Use the OpenAI key that is already verified, or Omnara model credits if Omnara exposes an OpenAI-compatible endpoint (check at the event).
2. A demo account with a loaded resume, two lanes, three applications waiting at form review, one at resume review, inbox messages classified, and three hand-approved applications so the Autopilot trust ladder is met. Put the login in the Devpost submission.
3. Walk the whole flow from a phone: sign up, onboarding, upload resume, open a job, apply, review the diff, review the form, approve. Fix what breaks. Nothing else ships until this passes.
4. Set `TELEGRAM_BOT_TOKEN` on the host so a judge can text the agent. Print the bot handle on the Auto apply page.
5. Freeze at 16:30. Record a two-minute backup video of the working demo in case the venue network fails.

### Track B: coverage with context.dev (the biggest product gap)

`docs/JOB-COVERAGE.md` says the biggest unlock is reading any career page, not only the four ATS feeds. context.dev gives scrape, search and change monitors, and every attendee has credits.

1. "Add a company by careers link" falls back to context.dev scrape when no known ATS is detected: read JobPosting markup, then the model, and create jobs.
2. A context.dev monitor per followed company, so a new posting on any company page reaches the agent tick without polling code of our own.
3. Show "found on <company> careers page via monitor" in the job drawer.

### Track C: Nori as an Omnara agent (sponsor fit, judges are from Omnara)

Nori already exposes MCP tools at `/mcp` (find_jobs, research_company, tailor_resume, apply, status, add_fact, skill_gaps). Launch an Omnara agent profile whose tools are Nori's MCP server, so the agent runs on Omnara's platform and can be reached from the Omnara console or Slack. Check first whether an Omnara profile can attach a remote MCP server; if not, drop this track.

### Track D: a paid tier with Stripe (production-ready story)

Stripe Checkout for "Nori Pro": raises `autoApplyDailyCap` from 3 to 20 and unlocks a second resume. Webhook sets a `plan` column on `users`. Test mode only. Shows the product could charge money today.

### Not doing

- Switching the database to Supabase (Neon works, the swap is risk without value).
- Turning on real submission against live postings.
- Workday or LinkedIn drivers.

## Suggested split for a team of up to four

| Person | Morning | Afternoon |
|---|---|---|
| 1 | Track A1 to A3 | Track A4, A5, Devpost write-up |
| 2 | Track B1 | Track B2, B3 |
| 3 | Track C check, then C or help B | Track C |
| 4 | Track D | Track D, then phone testing of everything |

Solo: Track A in full, then B1, then the write-up. Skip C and D.

## Demo script (two minutes)

1. Open the dashboard on the phone. "This is my career graph. Every line Nori writes traces to a node here."
2. Auto apply: lanes and the daily cap. Press Run now. The activity feed shows jobs found, skipped with reasons, one tailored.
3. Open the application: the diff with provenance, the Recruiter's view, the filled form with a screenshot. Approve.
4. Autopilot: show the 11 checks and the one it sent by itself.
5. Text the Telegram bot: "status", "skip the Stripe one, apply to the rest".
6. Paste any company's careers link on Companies. Nori reads it and finds the roles.
