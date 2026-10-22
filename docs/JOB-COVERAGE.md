# Beyond engineering: reaching every kind of job

Question: can Nori cover retail, hourly, part-time and every other kind of work (Ross, Burlington and the like), not only software and mechanical engineering? Is crawling career pages the answer? Can it apply on its own? Is a bigger model needed?

Date of research: 20 Oct 2026. Web results were thin in places; claims are marked **sourced**, **my knowledge** (not checked in this research) or **unverified**.

## The short answer

Split the problem in two, because they have different answers:

1. **Finding jobs (discovery): yes, broadly achievable.** Three routes, cheapest first: job-aggregator APIs, a generic "read any career page" reader built on the JobPosting markup most employers publish, and more hiring-platform feeds.
2. **Applying for them: mostly no, not automatically.** Retail and hourly hiring is built around account creation, long forms, chat bots and assessments. Safe, honest automation there is "prepare everything and take you to the right page", not "submit for you".

A bigger model helps with understanding messy pages and non-tech matching. It does not get around accounts, CAPTCHAs or assessments, and it should not.

## What we found

- **Ross uses Avature.** Checked directly: the public page `jobs.rossstores.com` references `avature.net` (also stated by a third-party guide, [resumegeni](https://resumegeni.com/companies/ross-stores/how-to-apply)). Its career pages carry **no** JobPosting markup in the HTML we fetched. Burlington's career site could not be reached from the addresses I tried; its platform is **unverified**.
- **Google's JobPosting markup is the common denominator.** Employers who want to appear in Google's job search add structured `JobPosting` data (title, description, hiring organisation, location, date posted, valid-through; optional pay and employment type) to each posting page ([Google documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting)). A reader for that markup works across many hiring platforms without a per-platform integration. Ross's pages did not carry it in what I fetched, so it will not cover everyone.
- **Workday exposes a public search endpoint per company site** that returns the JSON the career page renders from, according to scraper vendors (for example [this one](https://apify.com/ratio_tech/workday-scraper)). **Unverified by Workday's own documentation.** Workday is very common among large employers (**my knowledge**).
- **Aggregator APIs exist.** Adzuna's [official terms](https://developer.adzuna.com/docs/terms_of_service) give default limits of 25 calls a minute, 250 a day, 1,000 a week and 2,500 a month, require attribution ("The Adzuna API" with a link), allow other commercial use for a 14-day trial after which a licence may be needed (a 2026 copy of the terms reads stricter: check which applies). Careerjet's public API is meant for sites that embed search results and limits call frequency. Jooble has a free key-based API (terms not confirmed). The US government's [USAJOBS API](https://developer.usajobs.gov/) lists federal jobs for free with an API key (pricing claim from third parties).
- **Retail hiring is chat-bot and assessment heavy.** Paradox's Olivia handles screening, scheduling and candidate chat over SMS/chat for large hourly employers such as McDonald's, Chipotle and 7-Eleven (vendor figures, [VoiceBot](https://voicebot.ai/2020/05/13/enterprise-conversational-ai-startup-paradox-closes-40m-funding-round/), [G2](https://ai.g2.com/evaluations/categories/recruiting/paradox-olivia)). Many hourly applications also include availability questions (nights, weekends, holidays) and, from my knowledge, personality or "job preview" assessments and mandatory accounts.
- **Auto-apply at scale performs badly and is resisted.** Autofill helpers fill forms but leave submission to the person; full auto-apply platforms submit in bulk, with anecdotes of near-zero response rates and employers adding CAPTCHAs and verification ([Hiration](https://www.hiration.com/blog/ai-auto-apply-bots/), [Jobscan](https://www.jobscan.co/blog/auto-apply-job-tools/); low-quality sources, treat as indicative).
- **Legal footing of reading public pages.** Reading public pages is generally on firmer ground than reading behind a login, but not automatically allowed: it depends on each site's terms, how hard you hit it and what you do with the data. The hiQ v. LinkedIn case turned on the CFAA and ended with LinkedIn winning on its user agreement ([Bloomberg Law](https://news.bloomberglaw.com/artificial-intelligence/linkedins-war-against-bot-scrapers-ramps-up-as-ai-gets-smarter)). LinkedIn and Indeed forbid automation in their terms (**LinkedIn sourced; Indeed unverified**). Employers' own career pages are the safest ground, since they want to be found.

## Options

| # | Option | Gives you | Cost and limits | Risk |
|---|---|---|---|---|
| 1 | **Aggregator APIs** (Adzuna, Careerjet, Jooble, USAJOBS) | Instant breadth in every category, including retail and hourly, in many countries | Free tiers are small (Adzuna 250 calls a day); attribution required; apply link goes to the aggregator or employer page | Terms for commercial use; duplicate and stale ("ghost") postings; you do not control quality |
| 2 | **Generic career-page reader** (JobPosting markup, sitemaps, a model as fallback for pages without markup) | Any company a user adds by careers link, no per-platform work | Low per page; a model call only for pages without markup | Pages vary; some forbid crawling in robots.txt (respect it) |
| 3 | **More hiring-platform feeds** (Workday, plus small-business platforms such as Workable, Recruitee, BambooHR, Teamtailor, Personio, Breezy, JazzHR; **my knowledge, verify each**) | Large employers and thousands of local businesses and restaurants | One adapter per platform, verified live like the 186 boards | Workday terms and rate limits; per-platform upkeep |
| 4 | **A bigger model as the engine** | Reads any page, classifies jobs, matches non-tech experience | Pennies per page and up; slower | Mistakes on messy pages; cost at scale; does not remove accounts or CAPTCHAs |
| 5 | **A browser agent that applies on its own** | Could drive any form | A dollar or more per application, slow, fragile | Account creation, CAPTCHAs, assessments, terms violations, wrong answers sent in your name. I would not make this the default |
| 6 | **Assisted apply** | Opens the right page, with a ready answer sheet (availability, pay, authorisation, work history) to paste; tracks status and reminders | Cheap and reliable | Not "one click", but honest and works everywhere |

## Recommended plan

**Layer 1: discovery (the biggest unlock).** Do 2, then 1, then 3.
- Extend "add a company by careers link" so that when no known platform is found, Nori reads JobPosting markup, then a model as the fallback. This alone makes any employer addable.
- Add one aggregator (Adzuna first, plus USAJOBS for government work) behind the same search-provider interface planned in `docs/TOOLS.md`, with attribution shown.
- Add Workday and a handful of small-business platforms, each verified against real feeds the way the 186 boards were.

**Layer 2: matching that is not only about software skills.** Today the matching and profile are tuned for technical skills.
- Map every job and every user to a **job family** using a public occupation taxonomy such as O*NET (US government, free; **my knowledge**).
- Add what hourly work actually turns on: pay range, hours and shifts, **availability**, distance from home, transport, certifications, languages, age and work authorisation.
- Make the resume optional for roles that do not need one.

**Layer 3: applying.**
- Keep **review-before-submit** as the rule.
- Auto-fill only where it is safe: forms with no account wall and no CAPTCHA (the Greenhouse, Lever, Ashby style).
- Everywhere else, **assisted apply** (option 6).
- Never create accounts, solve CAPTCHAs or take assessments for the user.

## Effort and order (rough, one agent)

| Step | What | Hours |
|---|---|---|
| 1 | Generic career-page reader + "add any company" | 10 |
| 2 | One aggregator (Adzuna) + USAJOBS, with attribution and limits | 10 |
| 3 | Job-family classification, hourly filters, availability profile | 20 |
| 4 | Workday adapter, verified | 8 |
| 5 | Small-business platform adapters (3 to 5) | 10 |
| 6 | Assisted apply (answer sheet, open page, track) | 10 |

About 70 agent-hours for the lot; steps 1 and 2 alone widen coverage within roughly 20.

## Decisions for you

1. Which countries and cities first (aggregators and location search are per country)?
2. Is hourly and retail a core audience from day one, or an expansion after the first launch?
3. Are you comfortable that applying stays assisted for most of these jobs?
4. Do you accept the aggregator terms (attribution, call limits, a possible licence fee later)?
5. Appetite for a paid data source later if the free tiers run out.
