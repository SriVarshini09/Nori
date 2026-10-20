import type { Metadata } from "next";
import { api } from "@/lib/api";
import { AnswersEditor } from "@/components/AnswersEditor";
import { Channels, DangerZone, Integrations, SettingsForm } from "@/components/SettingsForm";
import { LogoutButton } from "@/components/LogoutButton";
import { ModelPanel } from "@/components/ModelPanel";
import { SecurityPanel } from "@/components/SecurityPanel";
import { Frame, PageHeader, SectionHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [{ user, profile }, integrations, channels, model] = await Promise.all([
    api.me(), api.listIntegrations().catch(() => []), api.listChannels().catch(() => []), api.modelSettings().catch(() => null),
  ]);
  const body = "col-span-12 lg:col-span-9 lg:col-start-4";
  return (
    <div>
      <PageHeader label="Settings" title={<>How much it does<br />on its own.</>} />
      <div className="space-y-24">
        <section>
          <SectionHeader index="01" label="Account" size="md" title={<>Your<br />account.</>} />
          <div className="mt-8 grid grid-cols-12">
            <div className={body}>
              <Frame className="p-5 sm:p-6">
                <dl className="-my-2 text-body-sm">
                  {[["Name", user.name ?? profile.fullName ?? "Not set"], ["Email", user.email]].map(([k, v], i) => (
                    <div key={k} className={`flex justify-between gap-4 py-2.5 ${i > 0 ? "border-t border-line" : ""}`}>
                      <dt className="text-muted">{k}</dt>
                      <dd className="truncate text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 border-t border-line pt-5"><LogoutButton /></div>
              </Frame>
            </div>
          </div>
        </section>
        <section>
          <SectionHeader index="02" label="Model &amp; keys" size="md" title={<>Which model<br />does the work.</>} />
          <div className="mt-8 grid grid-cols-12"><div className={body}><ModelPanel initial={model} /></div></div>
        </section>
        <section>
          <SectionHeader index="03" label="Automation" size="md" title={<>Gates and<br />limits.</>} />
          <div className="mt-8 grid grid-cols-12"><div className={body}><SettingsForm profile={profile} /></div></div>
        </section>
        <section>
          <SectionHeader index="04" label="Answers" size="md" title={<>What forms<br />get told.</>} />
          <div className="mt-8 grid grid-cols-12"><div className={body}><AnswersEditor profile={profile} /></div></div>
        </section>
        <section>
          <SectionHeader index="05" label="Integrations" size="md" title={<>Connected<br />tools.</>} />
          <div className="mt-8 grid grid-cols-12"><div className={body}><Integrations initial={integrations} /></div></div>
        </section>
        <section>
          <SectionHeader index="06" label="Channels" size="md" title={<>Where it<br />reaches you.</>} />
          <div className="mt-8 grid grid-cols-12"><div className={body}><Channels channels={channels} /></div></div>
        </section>
        <section>
          <SectionHeader index="07" label="Security" size="md" title={<>Password and<br />devices.</>} />
          <div className="mt-8 grid grid-cols-12"><div className={body}><SecurityPanel user={user} /></div></div>
        </section>
        <section>
          <SectionHeader index="09" label="Danger zone" size="md" title={<>Delete<br />everything.</>} />
          <div className="mt-8 grid grid-cols-12"><div className={body}><DangerZone email={user.email} /></div></div>
        </section>
      </div>
    </div>
  );
}
