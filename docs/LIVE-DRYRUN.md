# Live dry run on real application pages (20 Oct 2026)

Nothing was submitted, no account was created, and no real person's data was used. A fake test person ("Nori Dryrun", `example.com` address, a dummy PDF) was typed into real public application pages, a screenshot taken, and the run stopped. Repeat with `npm run dryrun:live` (it picks one posting per platform from the public feeds, or takes URLs as arguments). The script removes `ALLOW_REAL_SUBMIT` from its environment and refuses to start if it is `true`; the drivers also refuse to click submit unless `dryRun` is false **and** that variable is `true`.

## Results

| Platform | Posting | Result | What it means |
|---|---|---|---|
| **Greenhouse** | Affirm | Form found. **17 fields filled** (name, email, phone with country, resume, LinkedIn, sponsorship answers, preferred name, pronouns, state, EEO decline), **2 questions left** ("how did you hear", "previously employed here"). No CAPTCHA seen. | Works. The one platform where hands-free applying is realistic. |
| **Lever** | Wealthfront, Palantir | Form found. 14 and 9 fields filled. Stops at a **CAPTCHA** (hCaptcha). | Fills well; always needs a person for the CAPTCHA. Assisted apply only. |
| **Ashby** | Alan | Form found. 9 fields filled. Stops at a **CAPTCHA**. | Same: fills, then hands over. |
| **SmartRecruiters** | Bosch | The posting page loads, but the **application page refuses automated browsers** ("Access is temporarily restricted ... automated (bot) activity"). | Not automatable. Nori does not try to get around bot detection; it now hands the application to the person with that reason. |

An older Lever posting (Anyscale) returned 404 on its apply page: listings can go stale between the feed and the click.

## Defects the real pages exposed, and the fixes

1. **A receipt claimed a value the form did not keep.** Lever's location box was empty on screen while the receipt said "Seattle, WA, USA" (the page's own script cleared it after Nori typed). The filler now re-reads every text field after filling: what the form holds replaces what was typed, and a field that ended empty is not reported as filled (a required one becomes a question for the person).
2. **Labels carried the page's decoration** ("Resume/CV ✱ATTACH RESUME/CVCouldn't auto-read resume...", "RaceHispanic or LatinoA person of..."). They are cut at the marker and at the first option text, so receipts read cleanly and saved answers can match.
3. **Nori asked for things the profile already knows:** preferred name, pronouns, and "which state do you live in". Answered now from the profile (pronouns only when the person gave them, never guessed).
4. **SmartRecruiters' apply link was found by its English text** and missed in other languages ("Me interesa"). It is now found by its address.
5. **A bot-blocked page was reported as "no form found".** It is now a clear hand-off.

## What this means for Autopilot

Autopilot may only send on its own when the form needs no account, no CAPTCHA and no assessment. In practice that is **Greenhouse**. Lever and Ashby forms show a CAPTCHA, so their applications always wait for you (which is the correct outcome, not a bug). Workday-style and SmartRecruiters flows are assisted as well.

## Not covered

Real submission has still never been run on a live site. Forms differ per employer (custom questions), so each new company can still surface something; a dry run per new platform or unusual form is cheap.

## A side effect to know about

Probing the SmartRecruiters application page triggered its bot detection for the network this ran from (a temporary block page naming the public IP). It should lift by itself; it does not affect anything else.
