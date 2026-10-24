# Autopilot

Autopilot lets Nori send an application by itself, without asking, **only when every check passes**. Anything else waits for you exactly as before, with the reason written on the application's page.

## Where it sits

The normal flow is: find a job, tailor the resume, fill the form (a dry run, nothing sent), **wait for you to approve**, send. Autopilot replaces only the waiting step, and only when it can show there is nothing left to be sure about. It never changes what is sent: the form is submitted exactly as it was filled and checked.

Turn it on in **Auto apply** (three choices):

| Choice | Meaning |
|---|---|
| Off | You approve every form. This is the default. |
| Safe | Nori sends by itself only when every check passes. |
| Safe + short answers | The same, and it may send short free-text answers it wrote itself (for example "why this role"). |

Turning it on also turns "Review before submit" back on, because Autopilot works by replacing that wait. The older "review off" mode (send everything without looking) still exists and is unchanged; Autopilot is the guarded alternative.

## The 11 checks

All must pass. Code: `packages/core/src/runner/autopilot.ts`, tests `autopilot.test.ts` (each check alone) and `apps/api/src/autopilot.test.ts` (the whole flow through the real runner).

1. Autopilot is on.
2. The form is on a platform that needs no account, CAPTCHA or assessment: Greenhouse, Lever or Ashby. Workday, Avature, iCIMS, SmartRecruiters and plain web forms are always held.
3. The server is allowed to send (`ALLOW_REAL_SUBMIT=true`), so approving would really do something.
4. The match is at or above your minimum score (`autoApplyMinScore`, default 70%).
5. No conflict with citizenship, clearance, sponsorship, location, experience or pay (the same gate the agent uses before queuing).
6. **Nothing in the posting depends on a profile answer you have not given.** The gate lets an unknown profile field pass; Autopilot does not. A posting that says "US citizens only" with no status on your profile is held.
7. Every required question is answered and the form was filled completely.
8. Every answer comes from your profile. Free-text answers Nori wrote and the form actually used hold the application, unless you chose "short answers".
9. The tailored resume's ATS score is at least 70.
10. **Trust ladder:** you have approved at least 3 applications yourself that went out. Autopilot's own sends do not count.
11. You have not applied to the same company in the last 30 days.

## What you see

- On the application page, an **Autopilot** notice: "approved this form: all 11 checks passed", or "held this for your review: <reasons>".
- The timeline records every check and its result (event `autopilot`).
- On Auto apply, how many hand-approved applications you have (the trust ladder) and a plain list of the checks.

## What it does not do

It never creates accounts, solves CAPTCHAs, takes assessments or runs on sites that need them. Those applications stay assisted: Nori prepares everything and you finish. It does not bypass the server's submit lock. Live dry runs (`docs/LIVE-DRYRUN.md`) showed that in practice only **Greenhouse** forms are free of a CAPTCHA: Lever and Ashby showed one, and SmartRecruiters blocks automated browsers. Those applications always wait for you. Real submission has still never been exercised on a live site.

## Tuning

`AUTOPILOT_MIN_HUMAN_APPROVALS` (3), `AUTOPILOT_COMPANY_COOLDOWN_DAYS` (30), `AUTOPILOT_MIN_ATS_SCORE` (70) and `AUTOPILOT_PLATFORMS` live in `autopilot.ts`. Add a platform to the list only after a live dry run shows its form needs no account.

## Running it hands-free (set it, close the laptop)

The agent runs on the server, so it keeps working when your laptop is closed. A cycle runs every 20 minutes for every account that has a lane and a daily cap above zero: it finds roles, scores them, queues the best up to your cap, tailors, fills, and then either sends (Autopilot's checks all pass) or holds the application and messages you.

- **The resume no longer waits.** With Autopilot on, or "Review before submit" off, the tailored resume is approved automatically. The form is still held or sent by the 11 checks.
- **The trust rule is a setting.** `AUTOPILOT_MIN_APPROVALS` (default 3) is how many applications you must have approved by hand before Autopilot sends any. This deployment sets it to 1: approve one application yourself, then Autopilot is trusted.
- **Choose "Safe + short answers"** if you want it to send forms that ask for a short free-text answer; "Safe" holds those.
- **When something needs you** (a question it cannot answer from your profile, a held form, an emailed code) it messages your linked Telegram chat with the application link. Reply `skip 1` to drop one, or `approve 1` to send a held form. Answering form questions is done on the application page, from the link.
- Real sending needs `ALLOW_REAL_SUBMIT=true` on the server (set in `fly.toml`); with it off, Autopilot holds everything.
