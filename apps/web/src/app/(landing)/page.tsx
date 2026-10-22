import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { FinalCall, Hero, HowItWorks, PromiseSection, ProofStrip, Studio } from "@/components/home/Landing";
import { SiteHeader } from "@/components/home/SiteHeader";
import { PublicFooter } from "@/components/public/Chrome";

export const metadata: Metadata = {
  title: { absolute: "Nori: a job agent that cannot lie about you" },
  description: "Nori turns your resume into a career graph, finds roles that fit, tailors a one-page resume where every line traces to something you did, and fills the application for your approval.",
};

export default async function LandingPage() {
  // Only a session the API still accepts goes to the dashboard. A stale cookie used to make the landing page unreachable.
  if ((await cookies()).get("jg_session")?.value) {
    const signedIn = await api.session().then(() => true, () => false);
    if (signedIn) redirect("/dashboard");
  }
  return (
    <div className="min-h-screen bg-cream text-bark">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-bark focus:px-3 focus:py-2 focus:text-cream">Skip to content</a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <ProofStrip />
        <HowItWorks />
        <PromiseSection />
        <Studio />
        <FinalCall />
      </main>
      <div className="bg-cream"><PublicFooter /></div>
    </div>
  );
}
