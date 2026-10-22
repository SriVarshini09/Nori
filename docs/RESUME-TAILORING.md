# How Nori tailors a resume, designed as a recruiter would read it

The goal is a resume a hiring manager can use in ten seconds, for one specific job, that is **true in every line**. Tailoring is selection and emphasis. It is never invention.

## How a recruiter actually screens

1. **Filters first.** An applicant system and then a person check the must-haves: required skills, years of experience, level, location, work authorisation. Fail a filter and nothing else is read.
2. **The ten-second scan.** Name, current title, the summary, the top of the latest role, whether numbers jump out, whether it fits on a page. They read the top of the most recent role and skim the rest.
3. **Credibility.** Gaps, a long skills list with no proof behind it, the same keyword stuffed everywhere, claims that do not fit the dates, a level that does not match the job (too junior, or overqualified, which reads as a flight risk).
4. **Proof in context.** A skill named only in the skills list is weak; a skill used in a bullet with a result is strong.

What recruiters distrust is filler ("robust", "passionate", "expertise in", "proven track record") and claims with nothing behind them.

## What Nori does for each job

| Recruiter concern | Nori's move | Where |
|---|---|---|
| Must-haves present | Surfaces a required skill in the bullet that really used it, using the job's spelling, only when the linked evidence supports it. Adds a skill from your career graph to the skills list only if the graph backs it. | `rewrite.ts` |
| Summary | Two plain sentences: your latest real title, your real years (only where they help), the skills the job asks for that your resume proves; then one or two real results with their numbers. No employer list, no filler. For an entry-level post it leaves out seniority and years. | `heuristicSummary`, the model brief |
| Top of the latest role | Orders bullets by relevance to the job so the best match comes first. | `sortByRelevance` |
| Padding | In older roles, leaves out bullets that say nothing about the job (never the latest role, never emptying a role). Each one is listed in "what changed" as "left out of this version"; your original resume is untouched. | `selectBullets` |
| Impact and clarity | Replaces weak openers ("Responsible for") with the action verb; keeps bullets 12 to 24 words. | `verbs.ts` |
| Skills list | Required skills first, then nice-to-haves, then the rest; nothing added without evidence. | `tailorSkills` |
| Keyword stuffing | A skill may be appended to at most two bullets. | `MAX_APPENDS_PER_SKILL` |

## What Nori never does

- Invent a skill, number, employer, title, date or tool. Every rewritten bullet is checked against its own evidence: a new number, a new skill, filler the original did not use, a first-person pronoun, or a bad length means the rewrite is discarded and the original stays.
- Put a skill the job asks for into your summary when you have no evidence of it. This is tested for real: when asked to tailor to a Staff role requiring "System Design", the model wrote System Design into the summary and Nori rejected it and used the honest summary.
- Claim more years than your dates show, or years/seniority on an entry-level posting.
- Hide a gap. If you lack a required skill, the Recruiter's view says so plainly and tells you to add it only if it is true.

## The Recruiter's view (what you see)

On every application, next to the resume: a score out of 100, what the job asks for with each skill shown as *shown in your experience*, *only in the skills list* or *not on your resume*, what a recruiter would question with how to fix it, and what is working. It is computed fresh after every edit. Code: `packages/core/src/tailor/recruiter.ts`; tests `recruiter.test.ts`.

The score is out of 100: must-haves 35, level and experience 15, results shown 10, relevant bullets first 5, focus 5, clarity 10, summary 10, credibility 10. It is deterministic: no model, same answer every time.

## Measured (5 different jobs, one candidate, real model: gpt-4.1)

`npm run tailor:compare -- --model` tailors the sample candidate to five jobs (matching full-stack, frontend design systems, a platform role needing Go and Kubernetes the candidate lacks, a staff role, an entry-level role) and scores each result.

| | Untouched | Rules | Real model |
|---|---|---|---|
| Before this work | 67.8 | 85.4 | 83.0 |
| After | 67.8 | 85.8 | 85.8 |

The averages move little because several jobs already score near the ceiling and two have genuine gaps that must not be faked. What changed is quality, which the numbers do not capture: the stock summary every job got ("Senior Software Engineer with 10 years of hands-on experience in X. Experience spans 3 roles at ...") is now job-specific with real results; the model's filler ("expertise in", "performant", "scalable") is rejected; the model's summary now reaches the resume (before, every one was discarded because it contained the real "10 years"); and an entry-level job no longer gets a "Senior, 10 years" summary.

## Known limits

- The review is rule-based. It cannot judge writing quality beyond filler, length and structure; a person should still read the result.
- Relevance is keyword-based. A bullet that matters to the job in different words may be treated as less relevant.
- Selection is conservative: it only trims older roles of resumes with seven or more bullets.
- Tested on one candidate. Run `npm run tailor:compare` on your own resume (edit `sample.fixture.ts` or pass your own) before trusting the numbers for your case.
