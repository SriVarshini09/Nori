# Backlog

Ordered. Items marked (hackathon) are worth showing tomorrow; the rest come after.

## From the Tsenta walkthrough (docs/competitor-tsenta-notes.md)
1. Disqualifier gate before an application is created: citizenship, clearance, years of experience, location, sponsorship. Skip with a visible reason, or warn. (hackathon)
2. Review page: keyword coverage meter with covered and missing chips, a one-line "what I changed", hover-why, and a chat box routed to the tailor with the provenance validator. (hackathon, partly exists)
3. Receipt grouped by form section with field counts, radios shown selected vs not, confirmation email attached under the application.
4. Resume profiles: several base resumes per user, one default, pick per application. Replacing a resume must ask "replace graph" or "merge", never silently merge two histories (found during testing: two fixture resumes merged into one graph).
5. More application defaults in onboarding: in-person OK, start immediately, has transport, needs accommodations, prior employee, government ties. Sanity-check salary against role seniority.
6. Tracker stage "Ghosted" after N days without reply; email count per card.
7. Owned inbox address per user (inbound email domain to the API) so codes and confirmations arrive without OAuth. Post-hackathon.
8. Per-employer ATS credentials table with generated passwords, shown on the receipt; needed for Workday, Oracle, iCIMS drivers.
9. Template and font controls on the PDF.
10. Profile completeness meter; projects with tech tags and links feeding graph project nodes.
11. "Reach out at <company>" networking prompt via Parallel entity search. (hackathon if time)

## Engineering
- Workday driver (structured My Experience filling, account creation).
- OCR for scanned PDFs (tesseract.js + @napi-rs/canvas, optional).
- Browser isolation: one container per driver run.
- Multi-user hardening: rate limits, per-user artifact dirs already keyed by application id.
- Postgres in production (compose file exists); pgvector only if lexical matching proves weak with the LLM in the loop.
