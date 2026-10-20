import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { REPO_URL } from "@/components/public/Chrome";

export const metadata: Metadata = {
  title: { absolute: "Nori: a job agent that cannot lie about you" },
  description: "Nori turns your resume into a career graph, finds roles that fit, tailors a one-page resume where every line traces to something you did, and fills the application for your approval.",
};

const STEPS = [
  { n: "01", title: "It reads your history", body: "Add your resume once. Nori builds a career graph of your roles, projects, skills and results, and keeps a link from every fact back to where it came from." },
  { n: "02", title: "It finds and ranks roles", body: "Public postings on Greenhouse, Lever, Ashby and SmartRecruiters are scored against your graph, with the reasons shown: what matches, what is missing, what rules a role out." },
  { n: "03", title: "It tailors, then asks", body: "For each role it rewrites your resume from evidence only, fills the application form, and stops. You review the resume, then the form, and approve before anything is sent." },
] as const;

const PROOF = [
  { title: "Nothing is invented", body: "A rewritten line is accepted only if every number, tool and employer in it appears in your own graph. A line that fails the check is replaced by a safer one." },
  { title: "You hold the gate", body: "Resume review and form review are on by default. You can edit the resume, change an answer or skip the role at any point." },
  { title: "Yours to take", body: "Export your graph and any resume, or delete the account and everything with it. Nori is open source and can run on a local model." },
] as const;

const STUDIO = ["Seven templates, from a plain one-column classic to an executive serif", "Fonts, accent colour, size, spacing and margins; Letter or A4", "Live preview, section reordering, version history", "PDF, Word, plain text and JSON export", "An ATS check that tells you when a layout could scramble in an applicant system"];

export default async function LandingPage() {
  if ((await cookies()).get("jg_session")?.value) redirect("/dashboard");
  return (
    <>
      <section className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-10 sm:px-8 sm:pt-16">
        <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/15">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Open source job agent
        </p>
        <h1 className="mt-6 max-w-[18ch] font-display text-[2.8rem] font-medium leading-[0.98] tracking-[-0.05em] sm:text-[4.6rem]">
          A job search agent that cannot lie about you.
        </h1>
        <p className="mt-6 max-w-[56ch] text-[17px] leading-relaxed text-ink-2">
          Nori turns your resume into a career graph, finds roles that fit, tailors a one-page resume where every line traces back to something you actually did, and fills in the application. You approve before anything is sent.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/signup" className="dash-btn inline-flex h-12 items-center rounded-xl px-6 text-[15px] font-semibold">Create your account</Link>
          <Link href="/login" className="inline-flex h-12 items-center rounded-xl border border-black/10 bg-white px-6 text-[15px] font-semibold text-ink transition-colors hover:border-black/25">Sign in</Link>
        </div>
        <p className="mt-4 text-[13px] text-muted">Works with a local model or your own model key.</p>
      </section>

      <section aria-labelledby="how" className="border-y border-line bg-stone/40">
        <div className="mx-auto w-full max-w-[1120px] px-4 py-14 sm:px-8">
          <h2 id="how" className="font-display text-[1.9rem] font-medium tracking-[-0.03em] sm:text-[2.4rem]">How it works</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-2xl border border-line bg-paper p-6">
                <p className="text-label font-medium text-muted tnum">{s.n}</p>
                <h3 className="mt-3 font-display text-[1.25rem] font-medium tracking-[-0.02em]">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="trust" className="mx-auto w-full max-w-[1120px] px-4 py-14 sm:px-8">
        <h2 id="trust" className="font-display text-[1.9rem] font-medium tracking-[-0.03em] sm:text-[2.4rem]">Built to be trusted with your name</h2>
        <ul className="mt-8 grid gap-6 md:grid-cols-3">
          {PROOF.map((p) => (
            <li key={p.title} className="border-t-2 border-ink pt-4">
              <h3 className="font-display text-[1.2rem] font-medium tracking-[-0.02em]">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="studio" className="border-y border-line bg-stone/40">
        <div className="mx-auto grid w-full max-w-[1120px] gap-8 px-4 py-14 sm:px-8 md:grid-cols-[1fr_1.1fr] md:items-center">
          <div>
            <h2 id="studio" className="font-display text-[1.9rem] font-medium tracking-[-0.03em] sm:text-[2.4rem]">A resume studio, not a template</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">Edit your resume as a document, change the look in one click, and keep every version. Each application gets its own tailored copy that you can still edit before you approve it.</p>
          </div>
          <ul className="space-y-3 text-[15px] text-ink-2">
            {STUDIO.map((t) => (
              <li key={t} className="flex gap-3"><span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />{t}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1120px] px-4 py-16 text-center sm:px-8">
        <h2 className="mx-auto max-w-[20ch] font-display text-[2rem] font-medium leading-[1.05] tracking-[-0.04em] sm:text-[3rem]">Start with your resume. Nori does the rest.</h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="dash-btn inline-flex h-12 items-center rounded-xl px-6 text-[15px] font-semibold">Create your account</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center rounded-xl border border-black/10 bg-white px-6 text-[15px] font-semibold text-ink transition-colors hover:border-black/25">Read the source</a>
        </div>
      </section>
    </>
  );
}
