import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { INBOX_LABEL, NEEDS_YOU, pct } from "@/lib/format";
import type { AgentStatus, InboxMessage } from "@/lib/types";
import { Card, EmptyState, Notice, TextLink, cx } from "@/components/ui";
import { TimeAgo } from "@/components/TimeAgo";
import { WaitingList } from "@/components/today/WaitingList";
import { RunCycle } from "@/components/today/RunCycle";
import { ActivityFeed, cycleSummary } from "@/components/today/Activity";
import { MODE_LABEL } from "@/components/today/describe";
import { ago, inMin } from "@/components/agent/kinds";

export const metadata: Metadata = { title: "Today" };

const REPLY_KINDS: InboxMessage["kind"][] = ["interview", "offer", "recruiter_reply", "rejection", "confirmation"];

function StatusLine({ status }: { status: AgentStatus | null }) {
  if (!status) return <p className="text-body-sm text-muted">Agent status is unavailable right now.</p>;
  const items = [
    status.mode ? MODE_LABEL[status.mode] : null,
    status.lastTickAt ? `Last cycle ${ago(status.lastTickAt)}` : "No cycle yet",
    status.nextTickAt ? `next in ${inMin(status.nextTickAt)}` : null,
  ].filter(Boolean);
  return (
    <p className="text-body-sm text-muted" suppressHydrationWarning>
      {items.join(" · ")}
    </p>
  );
}

function CapCard({ status }: { status: AgentStatus | null }) {
  if (!status) return null;
  const used = status.usedToday;
  const cap = status.dailyCap;
  const share = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const lanesOn = status.lanes?.filter((l) => l.enabled).length ?? 0;
  const trust = status.autopilotTrust;
  const autopilot = status.autopilot ?? "off";
  return (
    <Card title="Today's cap" actions={<TextLink href="/agent">Lanes</TextLink>}>
      <div className="flex items-baseline justify-between">
        <span className="text-display-md font-semibold text-ink tnum">{used}<span className="text-body-sm font-normal text-muted"> of {cap}</span></span>
        <span className="text-meta text-muted">{lanesOn} lane{lanesOn === 1 ? "" : "s"} on</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} aria-label="Applications started today">
        <div className="h-full rounded-full bg-ink" style={{ width: `${share}%` }} />
      </div>
      {cap === 0 && <p className="mt-2 text-meta text-attn-fg">The cap is 0, so Nori starts nothing on its own.</p>}
      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-sm font-semibold text-ink">Autopilot</span>
          <span className={cx("rounded-full px-2 py-0.5 text-[12px] font-medium", autopilot === "off" ? "bg-sunken text-muted" : "bg-accent-tint text-accent-fg")}>
            {autopilot === "off" ? "Off" : autopilot === "safe" ? "On, profile answers only" : "On, short answers allowed"}
          </span>
        </div>
        <p className="mt-1.5 text-meta text-muted">
          {trust ? <>Trust: {trust.approved} of {trust.needed} hand approvals. </> : null}
          Minimum match {pct(status.minScore)}%.
        </p>
        <TextLink href="/agent#checks" className="mt-2">See the checks</TextLink>
      </div>
    </Card>
  );
}

export default async function TodayPage() {
  const [apps, status, activity, inbox] = await Promise.all([
    api.listApplications().catch(() => null),
    api.agentStatus().catch(() => null),
    api.agentActivity(40).catch(() => []),
    api.listInbox().catch(() => [] as InboxMessage[]),
  ]);
  const waiting = (apps ?? [])
    .filter((a) => NEEDS_YOU.includes(a.application.status))
    .sort((a, b) => +new Date(b.application.updatedAt) - +new Date(a.application.updatedAt));
  const cycle = cycleSummary(activity);
  const replies = inbox.filter((m) => REPLY_KINDS.includes(m.kind)).sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt)).slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-display-xl">Today</h1>
          <div className="mt-1"><StatusLine status={status} /></div>
        </div>
        <RunCycle />
      </header>

      {apps === null && <Notice tone="red">Cannot load your applications right now. Try again in a moment.</Notice>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="flex flex-col gap-3 lg:col-span-2" aria-labelledby="waiting-h">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="waiting-h" className="flex items-center gap-2 text-title font-semibold text-ink">
              Waiting on you
              {waiting.length > 0 && <span className="rounded-full bg-attn-tint px-2 text-[12px] font-semibold leading-5 text-attn-fg ring-1 ring-inset ring-attn tnum">{waiting.length}</span>}
            </h2>
            <TextLink href="/applications">All applications</TextLink>
          </div>
          {waiting.length > 0 ? (
            <WaitingList items={waiting} />
          ) : (
            <EmptyState title="Nothing is waiting on you">
              {status?.nextTickAt ? <>All caught up. The next cycle runs in {inMin(status.nextTickAt)}. </> : "All caught up. "}
              Nothing was sent without you.
            </EmptyState>
          )}
        </section>

        <div className="flex flex-col gap-5">
          <CapCard status={status} />
        </div>

        <Card className="lg:col-span-2" title={status?.lastTickAt ? <span suppressHydrationWarning>Last 24 hours</span> : "Last 24 hours"}>
          <dl className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {[
              ["Found", cycle.found],
              ["Queued", cycle.queued],
              ["Skipped", cycle.skipped],
              ["Waiting", cycle.waiting],
              ["Sent", cycle.sent],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-control bg-sunken px-3 py-2.5">
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="text-title font-semibold text-ink tnum">{v}</dd>
              </div>
            ))}
          </dl>
          {cycle.reasons.length > 0 && (
            <details className="group mt-4">
              <summary className="inline-flex cursor-pointer items-center gap-1 text-meta font-medium text-accent underline-offset-4 hover:underline">
                Why {cycle.skipped} {cycle.skipped === 1 ? "was" : "were"} skipped
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {cycle.reasons.map(([r, n]) => (
                  <li key={r} className="flex items-baseline justify-between gap-3 text-meta">
                    <span className="text-ink-2">{r}</span>
                    <span className="text-muted tnum">{n}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card title="Recent replies" actions={<TextLink href="/inbox">Inbox</TextLink>}>
          {replies.length === 0 ? (
            <p className="text-body-sm text-muted">No replies yet. They show up here when your inbox is connected.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {replies.map((m) => (
                <li key={m.id}>
                  <Link href={m.applicationId ? `/applications/${m.applicationId}` : "/inbox"} className="block rounded-control hover:bg-sunken/60">
                    <span className={cx("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold", m.kind === "interview" || m.kind === "offer" ? "bg-accent-tint text-accent-fg" : "bg-sunken text-ink-2")}>{INBOX_LABEL[m.kind]}</span>
                    <span className="mt-1 block truncate text-body-sm text-ink">{m.subject}</span>
                    <TimeAgo iso={m.receivedAt} className="text-[12px] text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3" title="Activity">
          <ActivityFeed items={activity} />
        </Card>
      </div>
    </div>
  );
}
