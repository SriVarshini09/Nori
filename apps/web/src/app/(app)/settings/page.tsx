import type { Metadata } from "next";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { Channels, DangerZone, Integrations, SettingsForm } from "@/components/SettingsForm";
import { LogoutButton } from "@/components/LogoutButton";
import { ModelUsage } from "@/components/ModelUsage";
import { SecurityPanel } from "@/components/SecurityPanel";
import { ThemeChoice } from "@/components/ThemeChoice";
import { Frame, Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { id: "model", label: "Model" },
  { id: "channels", label: "Channels and apps" },
  { id: "limits", label: "Limits and approvals" },
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account and security" },
] as const;

function Section({ id, title, line, children }: { id: string; title: string; line?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
      <h2 id={`${id}-h`} className="text-title font-semibold text-ink">{title}</h2>
      {line && <p className="mt-0.5 max-w-prose text-meta text-muted">{line}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const [me, integrations, channels, model, telegram] = await Promise.all([
    api.me().catch(() => null), api.listIntegrations().catch(() => []), api.listChannels().catch(() => []), api.modelSettings().catch(() => null), api.telegramInfo().catch(() => null),
  ]);
  if (!me) {
    return (
      <div>
        <PageHeader title="Settings" />
        <Notice tone="red">Cannot load your settings right now. Try again in a moment.</Notice>
      </div>
    );
  }
  const { user, profile } = me;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Nori's model, where it reaches you, and your account." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:self-start lg:px-0">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex h-9 shrink-0 items-center rounded-control px-3 text-[13.5px] font-medium text-ink-2 hover:bg-sunken hover:text-ink">{s.label}</a>
          ))}
        </nav>
        <div className="flex min-w-0 max-w-3xl flex-col gap-10">
          <Section id="model" title="Model" line="Which model writes for you, and how much of today's allowance is left.">
            <ModelUsage initial={model} />
          </Section>
          <Section id="channels" title="Channels and apps" line="Talk to Nori from your phone, and let it read mail, keep a sheet and hold interview times.">
            <div className="flex flex-col gap-5">
              <Frame className="p-4 sm:p-5"><Integrations initial={integrations} /></Frame>
              <Channels channels={channels} telegram={telegram} />
            </div>
          </Section>
          <Section id="limits" title="Limits and approvals" line="The same switches as on Lanes and autopilot, gathered here with the minimum match.">
            <SettingsForm profile={profile} />
          </Section>
          <Section id="appearance" title="Appearance" line="Saved in this browser only.">
            <ThemeChoice />
          </Section>
          <Section id="account" title="Account and security">
            <div className="flex flex-col gap-5">
              <Frame className="p-4 sm:p-5">
                <dl className="text-body-sm">
                  {[["Name", user.name ?? profile.fullName ?? "Not set"], ["Email", user.email]].map(([k, v], i) => (
                    <div key={k} className={`flex justify-between gap-4 py-2 ${i > 0 ? "border-t border-line" : ""}`}>
                      <dt className="text-muted">{k}</dt>
                      <dd className="truncate text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 border-t border-line pt-3"><LogoutButton /></div>
              </Frame>
              <SecurityPanel user={user} />
              <div>
                <h3 className="text-body-sm font-semibold text-danger-fg">Delete account</h3>
                <p className="mt-0.5 text-meta text-muted">Removes your account, graph, resumes and applications for good. This cannot be undone.</p>
                <div className="mt-3"><DangerZone email={user.email} /></div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
