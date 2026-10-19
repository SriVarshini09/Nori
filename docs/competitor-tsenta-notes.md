# Tsenta workflow notes (observed 2026-10-18 on a real Workday application)

## Mechanics they use that we do not yet
- Dedicated per-user inbox address (user@my-privatemail.com) used as the applicant email on every form. Verification and confirmation mail lands in Tsenta automatically; no Gmail OAuth needed. "Prefer your own email? Connect Gmail or Outlook" is optional.
- Per-employer ATS account creation (Workday): "Applied using <email>", "Account password: View". They generate and store a password per employer account.
- Confirmation email linked to the application ("Thank you for Applying", GE Vernova Workday Notifications) and surfaced on the receipt.
- Receipt grouped by form section with field counts: Personal Information (15), Work Experience (21), Education (8), Skills (10), Application Questions (7). Radios show selected vs not selected. Selects show "Selected from 23 options".
- Workday "My Experience" page filled structurally: each role as title, company, start, currently-work-here, end, location, description; each education as school, degree (picked from a dropdown), start and end year; skills one per entry.
- Tabs on the receipt: Form, Resume, Cover, Job.
- Stepper "Completed 4/4".
- "Reach out at <company>" networking prompt on every receipt.
- Referral nudge: share with a friend, both get 200 applications.
- Dashboard is a swipe feed (right to apply, left to skip), "Easy apply" badge, match % with level (Mid level, Experienced), "Tune my feed with AI", free plan counter (24 applications left).
- Auto Apply: paywalled (Power plan). Concept of "lanes" per role family drawing from one shared daily cap (10/day), chat to preview what it would apply to.
- Applications table tabs: All, Submitted, In flight, Needs you, Failed, Skipped. Rows per page selector.

## Resume tailoring behaviour
- Work experience descriptions on the form were augmented with extra sentences matched to the JD ("Owned the LLM integration and orchestration layer...", "Deployed custom AI models into production-grade AI/ML applications with multi-tenant isolation and high-availability design", "Ran model fine-tuning experiments..."). These sentences are not in the base resume: they add claims. Our provenance rule forbids this; that is the differentiator to say out loud.
- "How did you hear about this role?" was answered "GE Vernova Recruiter" (a questionable default). Ours defaults to Job board.

## Inbox
- Tabs: Inbox, Pipeline. Categories: All, Verification, Rejection, Interview, Recruiter, Assessment, Reminder, Offer, Applied.
- Each message shows the linked application chip (company, role, status), "Applied using <inbox address>", "Account password: View", sender, and a Reply button.
- "What's new" panel: Review Before Submit shipped Jul 1 2026 across Greenhouse, Workday, Ashby, Lever, Oracle, SmartRecruiters; auto-approve remains for hands-free.

## Settings (Apply settings)
- Resume optimization has three levels: Off, Honest, Aggressive. "Reorder and highlight relevant experience for each job." (Aggressive presumably adds claims; Honest reorders/highlights.)
- Auto-approve toggle ("Skip the preview step"). Review before submit toggle: "Works on Ashby, Greenhouse and 31 more ATSes."
- Cover letters generated automatically when a job asks, from profile plus a saved cover letter.
- Other settings pages: What Tsenta remembers (memory), Public portfolio, Workday password (one password reused for Workday accounts), Job Boards, Plans & billing, Referrals, Email integrations, AI assistants (MCP).

## Tracker (Pipeline)
- Columns: Running, Failed, Applied, Ghosted, Interviewing, Rejected, Offer. Each card shows company, role, date, email count. "Ghosted" is a stage.

## Research page
- Editorial content: "The biggest ATS myths", "Read this if you are not getting interviews". Claims 100k applications processed per 24 hours.

## Receipt: Resume tab and Cover tab
- "Optimized resume" with Download. It is the base resume with sentences appended to bullets and skills added to the Skills section (LangChain, LlamaIndex, RAG, Embedding Models, EKS, LLM Orchestration, Agentic Workflows, Model Fine-tuning, AI Observability) that were not in the uploaded resume. No diff view, no before/after, no ATS score on the receipt.
- Cover tab: "No cover letter was sent" when the form had no cover letter field.
- Job tab: the posting.

## What to adopt in jobgraph (ranked)
1. Dedicated per-user inbox address as the applicant email (solves verification codes and confirmations without any OAuth). Hackathon: Composio Gmail. After: inbound email domain (Cloudflare Email Routing or Postmark inbound) to the API.
2. Per-employer ATS account creation with a generated, stored password (Workday, Oracle, iCIMS). Needed for Workday support; show "Applied using" and the password on the receipt.
3. Receipt grouped by form section with field counts, radios shown as selected/not selected, confirmation email linked under the application.
4. Workday driver: structured My Experience filling (roles, education with degree picker, skills one per entry).
5. Tracker stage "Ghosted" (no reply after N days) and email count per card.
6. Resume optimization levels: Off / Honest / Aggressive. We keep Honest as the only mode with provenance; Aggressive would add claims and we refuse that on purpose (our pitch).
7. Networking prompt on the receipt ("Reach out at <company>") via Parallel entity search for the demo.
8. Referral loop and plan counters later.

## Live apply flow (Peraton, LLM Specialist, observed 2026-10-18)
- Clicking Apply on a feed card jumps straight to the application page with `?firstRun=1`. Banner "Waiting for a worker to pick this up" then "Waiting for the agent...". Stepper 4 steps: Optimize -> (fill) -> Submit; the text showed "Optimizing Resume 1/4" then "Submitting 3/4" within about 10 s.
- Tabs during the run: Resume, JD. "Skip & use original resume" and "Skip & use default resume" escape hatches.
- Resume optimization UX (new, "rebuilt"): 
  - Match meter: "Fair match: 4 of 16 keywords covered on your tailored resume", chips for covered keywords and "+" chips for missing ones (LLMs, transformer models, fine-tuning, PEFT, prompt engineering, cloud, multi-agent, eval frameworks, hybrid search, graph retrieval, long-context, quantization/distillation).
  - "WHAT I CHANGED: Rewrote 3 bullets to lead with impact". Hover any highlight on the right to see why.
  - Chat: "Ask me to change anything..." with suggestion chips: "Weave in the missing keywords I genuinely have", "Make the summary punchier", "Fit it to one page". Agent narrates its plan ("Let me analyze the missing keywords and make my edits").
  - Resume editor toolbar: Template (Standard, Jake), font family (Arial, Calibri, Garamond, Georgia, Times New Roman, Computer Modern), size 9pt +/-, align left/justified, Fit to one page, Reorder sections, More, "3 edits · tailored", Download.
  - Observed edit: "multi-model LLM inference" became "multi-model large language model (LLM) inference" (keyword expansion).
- Disqualifier miss: the posting requires "US Citizen with the ability to obtain/maintain a Public Trust clearance" and 8 years with BS / 6 with MS. Tsenta applied anyway. Our disqualifier check must block or warn on citizenship/clearance/years requirements before spending an application.

## Adopt from this
- Keyword coverage meter with covered vs missing chips on our review page (we already compute keywordCoverage).
- "What I changed" summary line plus hover-why (we have reasons; present them this way).
- Chat on the review page to request edits ("make it punchier", "fit to one page") routed to the tailor with the provenance validator.
- Template and font controls on the PDF (cheap: our template has density; add font family and size).
- Escape hatch "Use original resume".

## Peraton result (iCIMS): Submitted in about 60 to 90 s from click
- Receipt captured 2 emails immediately ("Thank You for submitting your resume!", reminder "You've started your job application!") thanks to the owned inbox address.
- Form receipt sections: Personal Information (9), Work Experience (2), Application Questions (15), Voluntary Disclosures (3). Selects show "Selected from N options".
- Quality problems in their answers (our opening):
  - "Are you a US citizen?" answered No, while the posting requires a US citizen with Public Trust clearance: the application was wasted. A disqualifier gate should have skipped it or warned before spending a credit.
  - "What are your current compensation requirements?" filled with 80000 for a senior LLM specialist role: looks like a default, not the user's number. We collect salary expectation in onboarding.
  - "Address 2" duplicated Address line 1.
  - "How did you hear about us?" = Social Media; "Please specify" = English (nonsense pairing).
  - Years-of-experience requirement (8 with BS / 6 with MS) ignored.
- Timing benchmark to beat or match: resume tailoring plus fill plus submit in about a minute.

## Resume section (Profile)
- Multiple resume PROFILES (e.g. "Default"): rename, star as default, delete, Add Profile. Each profile has three tabs: Resume, Cover Letter, Profile Details. Bulk apply has "Pick profile for bulk apply".
- Resume tab: rendered editable document with a page-break marker ("Content below will appear on next page"), Replace (upload a new file), Download PDF, and a resume assistant chat with starters "Improve this resume", "Tailor it for a role", "Work on my cover letter"; "I'll keep changes tied to the selected version".
- Profile Details: "97% complete" meter, Open to work badge, professional summary, education, experience with computed durations ("6 mo"), projects with tech tags and Live / GitHub links, custom sections, Skills grouped by category (23 across 7).
- "Application defaults: what we auto-fill on every ATS form": Work authorization (country, visa type e.g. OPT, authorized yes/no, needs sponsorship), Work preferences (expected salary, in-person OK, can relocate, start immediately, has transport, needs accommodations), Background (prior employee, gov clearance, gov ties).
- Correction to the Peraton note: the 80000 compensation answer came from the profile's stored "Expected salary" default, not a Tsenta guess. The product problem is that it never asked whether that number fits a senior role.

## Adopt
- Resume profiles (several base resumes per user, one default, pick per application).
- Our onboarding already mirrors "Application defaults"; add: in-person OK, start immediately, has transport, needs accommodations, prior employee, government ties.
- Profile completeness meter.
- Projects with tech tags and links feeding graph project nodes.
