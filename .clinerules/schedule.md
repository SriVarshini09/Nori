# Scheduled agent runs

The agent works for the user on a schedule. One cycle (discover, score, gate, queue, advance, ask for reviews over chat) is:

```
npm run agent:tick
```

It prints the cycle summary as JSON (`discovered`, `scored`, `queued`, `skipped[{job, reasons}]`, `awaitingReview`, `submitted`, `needsUser`, `errors`) and exits 0, or exits 1 with the error on stderr.

- When the API is up (`API_URL`, default `http://localhost:4000`) the tick runs inside the API through `POST /api/agent/tick`, because the API owns the embedded PGlite database. The API must be started with `DEFAULT_USER_EMAIL` set so an unauthenticated script acts as that user.
- When the API is down the script opens the database directly. Never run two processes against the same `data/pglite` directory.

## With `cline schedule`

Run a tick every 30 minutes on weekdays from 8:00 to 20:00 (check `cline schedule --help` for the exact flags of your Cline version):

```
cline schedule add "jobgraph agent tick" --cron "*/30 8-20 * * 1-5" --cwd C:/dev/jobgraph -- npm run agent:tick
cline schedule list
cline schedule remove "jobgraph agent tick"
```

When asked to review a scheduled run, read the JSON: report `queued` jobs, every `skipped` reason, and anything in `errors`. Do not change `autoApplyDailyCap`, `reviewBeforeSubmit` or `ALLOW_REAL_SUBMIT` from a scheduled run; the user changes those over chat (`set daily cap 3`, `review before submit off`).

## Long-running alternative

`npm run worker` ticks on its own every `AGENT_TICK_MINUTES` (default 20), sends the morning brief at `BRIEF_HOUR` (default 8, local time), a weekly summary on Mondays, and syncs the inbox every 5 minutes when Composio is configured. `npm run agent` does the same with a console chat on stdin/stdout (no tokens needed). Do not run the worker and a scheduled tick against the same PGlite directory unless the API is up.
