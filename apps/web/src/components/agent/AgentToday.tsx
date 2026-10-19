import Link from "next/link";
import type { AgentActivity, AgentStatus } from "@/lib/types";
import { Frame, Icon, IndexLabel, TextLink } from "../ui";
import { TimeAgo } from "../TimeAgo";
import { KIND_ICON } from "./kinds";

/** Compact dashboard summary of the agent's day: three numbers and the last three activity lines. */
export function AgentToday({ status, activity }: { status: AgentStatus | null; activity: AgentActivity[] }) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const found = activity
    .filter((a) => a.kind === "discovered" && new Date(a.ts) >= startOfDay)
    .reduce((n, a) => n + (a.data.count ?? 0), 0);
  const nums = [
    { label: "Found", value: found },
    { label: "Applied", value: status?.usedToday ?? 0 },
    { label: "Waiting", value: status?.awaitingReview.length ?? 0 },
  ];
  const last = activity.slice(0, 3);

  return (
    <Frame as="section">
      <header className="flex h-12 items-center justify-between border-b border-line px-4 sm:px-6">
        <IndexLabel index="02" marker tone="ink">Auto apply today</IndexLabel>
        <TextLink href="/agent">Open agent</TextLink>
      </header>
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid grid-cols-3 border-b border-line lg:border-b-0 lg:border-r">
          {nums.map((n, i) => (
            <div key={n.label} className={i > 0 ? "border-l border-line p-4 sm:p-6" : "p-4 sm:p-6"}>
              <div className="font-display text-[2.25rem] font-medium leading-none tracking-[-0.04em] text-ink tnum">{n.value}</div>
              <div className="mt-2 text-label font-medium uppercase text-muted">{n.label}</div>
            </div>
          ))}
        </div>
        {last.length === 0 ? (
          <p className="p-4 text-body-sm text-muted sm:p-6">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {last.map((a) => (
              <li key={a.id}>
                <Link href="/agent" className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-stone/50 sm:px-6">
                  <Icon icon={KIND_ICON[a.kind]} className="text-ink-2" />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{a.message}</span>
                  <TimeAgo iso={a.ts} className="shrink-0 text-[12px] text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Frame>
  );
}
