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
  if (!status) return <p className="text-body-sm text-ink-2">Agent status is unavailable right now.</p>;
  const items = [
    status.mode ? MODE_LABEL[status.mode] : null,
    status.lastTickAt ? `Last cycle ${ago(status.lastTickAt)}` : "No cycle yet",
    status.nextTickAt ? `next in ${inMin(status.nextTickAt)}` : null,
  ].filter(Boolean);
  return (
    <p className="text-body-sm text-ink-2" suppressHydrationWarning>
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
    <Card title="Today's cap" actions={<TextLink href="/agent">Lanes</TextLink>} className="bento-mint">
      <div className="flex items-baseline justify-between">
        <span className="text-display-md font-semibold text-ink tnum">
          {used}
          <span className="text-body-sm font-normal text-ink-2"> of {cap}</span>
        </span>
        <span className="rounded-full bg-white/85 px-2.5 py-0.5 text-meta font-medium text-accent-fg shadow-2xs">
          {lanesOn} lane{lanesOn === 1 ? "" : "s"} on
        </span>
      </div>
      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-white/90 shadow-inner" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} aria-label="Applications started today">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,#158f6a_0%,#0b664a_100%)] transition-all" style={{ width: `${share}%` }} />
      </div>
      {cap === 0 && <p className="mt-2.5 text-meta font-medium text-attn-fg">The cap is 0, so Nori starts nothing on its own.</p>}
      <div className="mt-5 border-t border-[#bce6d1]/70 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-sm font-semibold text-ink">Autopilot</span>
          <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", autopilot === "off" ? "bg-white/85 text-ink-2" : "bg-accent text-white")}>
            {autopilot === "off" ? "Off" : autopilot === "safe" ? "On, profile answers only" : "On, short answers allowed"}
          </span>
        </div>
        <p className="mt-1.5 text-meta text-ink-2">
          {trust ? <>{trust.needed === 0 ? "No hand approvals needed. " : `Trust: ${trust.approved} of ${trust.needed} hand approvals. `}</> : null}
          Minimum match {pct(status.minScore)}%.
        </p>
        <TextLink href="/agent#checks" className="mt-2">See the checks</TextLink>
      </div>
    </Card>
  );
}

const KPI_TILES: { label: string; key: "found" | "queued" | "skipped" | "waiting" | "sent"; cls: string }[] = [
  { label: "Found", key: "found", cls: "bento-sky border" },
  { label: "Queued", key: "queued", cls: "bento-mint border" },
  { label: "Skipped", key: "skipped", cls: "border border-line bg-sunken/70" },
  { label: "Waiting", key: "waiting", cls: "bento-honey border" },
  { label: "Sent", key: "sent", cls: "bento-lavender border" },
];

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

  const kpiValues = {
    found: cycle.found,
    queued: cycle.queued,
    skipped: cycle.skipped,
    waiting: waiting.length,
    sent: cycle.sent,
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Sunlit Matcha & Honey Morning Briefing Banner */}
      <div className="bento-hero flex flex-wrap items-center justify-between gap-4 rounded-card border border-[#bce6d1] p-5 shadow-[0_10px_30px_-10px_rgba(13,117,86,0.10)] sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[1.8rem] font-semibold leading-tight tracking-[-0.024em] text-ink sm:text-display-xl">Today</h1>
            {waiting.length > 0 ? (
              <span className="rounded-full bg-attn px-3 py-0.5 text-[12px] font-semibold text-white shadow-2xs tnum">
                {waiting.length} waiting on you
              </span>
            ) : (
              <span className="rounded-full border border-[#bce6d1] bg-[#e5f8ee] px-3 py-0.5 text-[12px] font-semibold text-accent-fg shadow-2xs">
                All caught up
              </span>
            )}
          </div>
          <div className="mt-1"><StatusLine status={status} /></div>
        </div>
        <RunCycle />
      </div>

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
            <EmptyState title="Nothing is waiting on you" pose="sleeping">
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
            {KPI_TILES.map((tile) => (
              <div key={tile.label} className={cx("rounded-control px-3.5 py-3 shadow-2xs", tile.cls)}>
                <dt className="text-meta font-medium text-ink-2">{tile.label}</dt>
                <dd className="mt-1 text-display-md font-semibold text-ink tnum">{kpiValues[tile.key]}</dd>
              </div>
            ))}
          </dl>
          {cycle.reasons.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-meta font-medium text-ink">Why jobs were skipped</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {cycle.reasons.map(([r, c]) => (
                  <li key={r} className="rounded-full bg-sunken px-2.5 py-0.5 text-meta text-ink-2 tnum">
                    {r} <span className="text-muted">· {c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Recent replies" actions={<TextLink href="/inbox">Inbox</TextLink>} className="bento-sky">
          {replies.length === 0 ? (
            <p className="text-body-sm text-ink-2">No replies yet. Confirmations, interview invites and rejections appear here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {replies.map((m) => (
                <li key={m.id} className="py-2.5 first:pt-0 last:pb-0">
                  <Link href={m.applicationId ? `/applications/${m.applicationId}` : "/inbox"} className="block rounded-control hover:bg-white/60">
                    <div className="flex items-center justify-between gap-2 text-meta">
                      <span className="font-medium text-ink">{INBOX_LABEL[m.kind]}</span>
                      <TimeAgo iso={m.receivedAt} className="text-muted" />
                    </div>
                    <p className="mt-0.5 truncate text-body-sm text-ink-2">{m.subject}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3" title="Activity" actions={<TextLink href="/agent">Lanes and autopilot</TextLink>}>
          <ActivityFeed items={activity.slice(0, 12)} />
        </Card>
      </div>
    </div>
  );
}
