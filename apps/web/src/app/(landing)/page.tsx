import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { Anywhere } from "@/components/landing/Anywhere";
import { Finale, Yours } from "@/components/landing/Finale";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { Honest } from "@/components/landing/Honest";
import { Story } from "@/components/landing/Story";

export const metadata: Metadata = {
  title: { absolute: "Nori: a job agent that cannot lie about you" },
  description: "Nori turns your resume into a career graph, finds roles that fit, tailors a one-page resume where every line traces to something you did, and fills the application for your approval.",
};

export default async function LandingPage() {
  // Only a session the API still accepts goes to Today. A stale cookie must not make the landing page unreachable.
  if ((await cookies()).get("jg_session")?.value) {
    const signedIn = await api.session().then(() => true, () => false);
    if (signedIn) redirect("/dashboard");
  }
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-on-ink">Skip to content</a>
      <Header />
      <main id="main">
        <Hero />
        <Story />
        <Honest />
        <Anywhere />
        <Yours />
        <Finale />
      </main>
    </>
  );
}
