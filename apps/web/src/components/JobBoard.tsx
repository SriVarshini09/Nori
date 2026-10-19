"use client";

import { SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ApplicationStatus, JobWithMatch } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/format";
import { ApplyButton } from "./ApplyButton";
import { cx, idx } from "./cx";
import { Frame } from "./Frame";
import { Square } from "./IndexLabel";
import { MatchRing } from "./MatchRing";
import { STATUS_MARK } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { EmptyState, inputClass } from "./ui";
import {
  DEFAULT_FILTERS, SENIORITY_ORDER, activeFilterCount, filtersToParams, monogram, placeName, postedIso,
  seniorityKey, seniorityLabel, skillChips, sourceLabel, workMode, type BoardFilters,
} from "./jobMeta";

export type BoardApp = { id: string; status: ApplicationStatus };

const railLabel = "flex items-center gap-2 text-label font-medium uppercase text-muted";

function RailSection({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={railLabel}><span className="text-faint tnum">{idx(n)}</span>{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Square checkbox row: native input (visually hidden) drives an ink square. */
function CheckRow({ checked, onChange, label, count }: { checked: boolean; onChange: (v: boolean) => void; label: string; count?: number }) {
  return (
    <label className="group flex cursor-pointer items-center gap-2.5 py-1 text-body-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className={cx("flex h-3 w-3 shrink-0 items-center justify-center border transition-colors duration-150 peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink", checked ? "border-ink bg-ink" : "border-line-strong group-hover:border-ink")}>
        {checked && <span className="h-1 w-1 bg-paper" />}
      </span>
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-[12px] text-faint tnum">{count}</span>}
    </label>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 py-1 text-left text-body-sm text-ink">
      {label}
      <span className={cx("relative h-[18px] w-8 shrink-0 rounded-full border transition-colors duration-150", checked ? "border-ink bg-ink" : "border-line-strong")}>
        <span className={cx("absolute top-[3px] h-2.5 w-2.5 rounded-full transition-[left,background-color] duration-150 ease-[var(--ease)]", checked ? "left-[17px] bg-paper" : "left-[3px] bg-faint")} />
      </span>
    </button>
  );
}

const pillCls = "inline-flex h-[22px] max-w-full items-center rounded-full px-2 text-[11.5px] font-medium leading-none";

/** One job as a framed card: monogram row, display title, meta pills, match ring + skill chips, actions. */
export function BoardCard({ item, app, href }: { item: JobWithMatch; app?: BoardApp | null; href: string }) {
  const { job, match } = item;
  const mode = workMode(job);
  const place = placeName(job.location);
  const sen = seniorityKey(job);
  const chips = skillChips(match);
  const matchedN = new Set(match?.explanation.matched.map((m) => m.requirement.toLowerCase())).size;
  const totalN = matchedN + new Set(match?.explanation.missing.map((m) => m.requirement.toLowerCase())).size;
  const status = app?.status ?? item.applicationStatus ?? null;

  return (
    <Frame as="article" className="flex h-full flex-col p-5 transition-colors duration-150 ease-[var(--ease)] hover:border-line-strong">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center bg-ink font-display text-[12px] font-medium tracking-[0.04em] text-paper">
          {monogram(job.companyName)}
        </span>
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-ink">{job.companyName}</span>
        <TimeAgo iso={postedIso(job)} className="shrink-0 text-[12px] text-faint" />
      </div>

      <h3 className="mt-5">
        <Link href={href} scroll={false} className="line-clamp-3 font-display text-[20px] font-medium leading-[1.12] tracking-[-0.025em] text-ink decoration-line-strong decoration-1 underline-offset-[5px] hover:underline" title={job.title}>
          {job.title}
        </Link>
      </h3>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={cx(pillCls, "bg-stone text-ink-2")} title={job.location ?? undefined}>
          <span className="truncate">{place ?? (mode === "Remote" ? "Anywhere" : "Location n/a")}</span>
        </span>
        <span className={cx(pillCls, "bg-stone text-ink-2")}>{mode}</span>
        {sen && <span className={cx(pillCls, "bg-stone text-ink-2")}>{seniorityLabel(sen)}</span>}
        <span className={cx(pillCls, "border border-line text-muted")}>{sourceLabel(job.atsType)}</span>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center gap-3">
          <MatchRing score={match?.score} />
          <div className="min-w-0">
            <div className="text-label font-medium uppercase text-muted">Match</div>
            <div className="mt-0.5 text-meta text-ink-2 tnum">
              {match ? (totalN ? `${matchedN} of ${totalN} requirements in your graph` : "Scored on title and level") : "Not scored yet"}
            </div>
          </div>
        </div>
        {chips.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Skills">
            {chips.map((c) => (
              <li
                key={c.name}
                title={c.matched ? "In your career graph" : `Missing${c.required ? " (required)" : ""}`}
                className={cx(
                  "rounded-[var(--radius-tag)] px-1.5 py-[2px] text-[12px] leading-[1.35]",
                  c.matched ? "bg-stone text-ink" : "border border-line text-muted line-through decoration-faint decoration-1",
                )}
              >
                {c.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto pt-5">
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <Link href={href} scroll={false} className="shrink-0 text-meta font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:decoration-ink">
            Details
          </Link>
          {status ? (
            <Link
              href={app ? `/applications/${app.id}` : href}
              title={`Applied · ${STATUS_LABEL[status] ?? status}`}
              className="inline-flex h-9 min-w-0 items-center gap-2 whitespace-nowrap rounded-full bg-stone px-3 text-[12px] font-medium text-ink transition-colors duration-150 hover:bg-stone-2"
            >
              <Square tone={STATUS_MARK[status] ?? "muted"} size={6} />
              <span className="truncate">Applied &middot; {STATUS_LABEL[status] ?? status}</span>
            </Link>
          ) : (
            <ApplyButton jobId={job.id} />
          )}
        </div>
      </div>
    </Frame>
  );
}

/** Job board: filter rail on the left (sheet on phones), responsive card grid on the right. */
export function JobBoard({ items, apps, initial }: { items: JobWithMatch[]; apps: Record<string, BoardApp>; initial: BoardFilters }) {
  const [f, setF] = useState<BoardFilters>(initial);
  const [railOpen, setRailOpen] = useState(false);
  const set = <K extends keyof BoardFilters>(k: K, v: BoardFilters[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const toggleIn = (k: "seniority" | "sources", v: string, on: boolean) =>
    setF((prev) => ({ ...prev, [k]: on ? [...prev[k], v] : prev[k].filter((x) => x !== v) }));

  const params = filtersToParams(f).toString();
  useEffect(() => {
    const cur = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(params);
    const job = cur.get("job");
    if (job) next.set("job", job);
    const qs = next.toString();
    if (qs !== cur.toString()) window.history.replaceState(window.history.state, "", `/jobs${qs ? `?${qs}` : ""}`);
  }, [params]);

  const facets = useMemo(() => {
    const sen = new Map<string, number>();
    const src = new Map<string, number>();
    for (const { job } of items) {
      const s = seniorityKey(job);
      if (s) sen.set(s, (sen.get(s) ?? 0) + 1);
      src.set(job.atsType, (src.get(job.atsType) ?? 0) + 1);
    }
    const order = (k: string) => (SENIORITY_ORDER.indexOf(k) + 1 || 99);
    return {
      seniority: [...sen].sort((a, b) => order(a[0]) - order(b[0])),
      sources: [...src].sort((a, b) => b[1] - a[1]),
      remote: items.filter(({ job }) => workMode(job) === "Remote").length,
      applied: items.filter(({ job, applicationStatus }) => apps[job.id] || applicationStatus).length,
    };
  }, [items, apps]);

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const out = items.filter(({ job, match, applicationStatus }) => {
      if (q) {
        const hay = [job.title, job.companyName, job.location ?? "", ...(job.requirements?.skills.map((s) => s.name) ?? [])].join(" ").toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (f.min && Math.round((match?.score ?? 0) * 100) < f.min) return false;
      if (f.remote && workMode(job) !== "Remote") return false;
      if (f.seniority.length && !f.seniority.includes(seniorityKey(job) ?? "")) return false;
      if (f.sources.length && !f.sources.includes(job.atsType)) return false;
      if (f.hideApplied && (apps[job.id] || applicationStatus)) return false;
      return true;
    });
    const t = (j: JobWithMatch) => new Date(postedIso(j.job)).getTime() || 0;
    return out.sort((a, b) => (f.sort === "new" ? t(b) - t(a) : (b.match?.score ?? -1) - (a.match?.score ?? -1) || t(b) - t(a)));
  }, [items, apps, f]);

  const PAGE = 12;
  const [page, setPage] = useState({ key: params, n: PAGE });
  const limit = page.key === params ? page.n : PAGE;
  const visible = shown.slice(0, limit);

  const active = activeFilterCount(f);
  const hrefFor = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("job", id);
    return `/jobs?${p}`;
  };

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[216px_minmax(0,1fr)]">
      <div className="flex items-center justify-between gap-3 border-y border-line py-3 lg:hidden">
        <span className="text-label font-medium uppercase text-muted tnum">{shown.length} of {items.length} roles</span>
        <button
          type="button"
          onClick={() => setRailOpen((o) => !o)}
          aria-expanded={railOpen}
          aria-controls="job-filters"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-line px-3.5 text-[12px] font-medium uppercase tracking-[0.09em] text-ink transition-colors duration-150 hover:border-ink"
        >
          Filters{active > 0 && <span className="text-faint tnum">{active}</span>}
          <span aria-hidden="true" className="flex h-3.5 w-3.5 items-center justify-center border border-ink text-[10px] leading-none">{railOpen ? "−" : "+"}</span>
        </button>
      </div>

      <aside id="job-filters" className={cx("lg:sticky lg:top-20 lg:block lg:self-start", railOpen ? "block" : "hidden")} aria-label="Filters">
        <RailSection n={1} title="Search">
          <input
            type="search"
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Title, skill, city"
            aria-label="Search jobs"
            className={inputClass}
          />
        </RailSection>
        <RailSection n={2} title="Min match" aside={<span className="font-display text-[15px] font-medium tracking-[-0.02em] text-ink tnum">{f.min}%</span>}>
          <input type="range" min={0} max={100} step={5} value={f.min} onChange={(e) => set("min", Number(e.target.value))} aria-label="Minimum match" className="h-4 w-full cursor-pointer" />
          <div className="mt-1 flex justify-between text-[11px] text-faint tnum"><span>0</span><span>50</span><span>100</span></div>
        </RailSection>
        <RailSection n={3} title="Work mode">
          <Switch checked={f.remote} onChange={(v) => set("remote", v)} label={`Remote only · ${facets.remote}`} />
        </RailSection>
        {facets.seniority.length > 0 && (
          <RailSection n={4} title="Seniority">
            {facets.seniority.map(([k, c]) => (
              <CheckRow key={k} label={seniorityLabel(k)} count={c} checked={f.seniority.includes(k)} onChange={(on) => toggleIn("seniority", k, on)} />
            ))}
          </RailSection>
        )}
        <RailSection n={5} title="Source">
          {facets.sources.map(([k, c]) => (
            <CheckRow key={k} label={sourceLabel(k)} count={c} checked={f.sources.includes(k)} onChange={(on) => toggleIn("sources", k, on)} />
          ))}
        </RailSection>
        <RailSection n={6} title="Status">
          <Switch checked={f.hideApplied} onChange={(v) => set("hideApplied", v)} label={`Hide applied · ${facets.applied}`} />
        </RailSection>
        <RailSection n={7} title="Sort">
          <div role="radiogroup" aria-label="Sort" className="grid grid-cols-2 rounded-full border border-line p-[3px]">
            {([["match", "Match"], ["new", "Newest"]] as const).map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={f.sort === k}
                onClick={() => set("sort", k)}
                className={cx("h-7 rounded-full text-[12px] font-medium transition-colors duration-150", f.sort === k ? "bg-ink text-paper" : "text-muted hover:text-ink")}
              >
                {l}
              </button>
            ))}
          </div>
        </RailSection>
        <div className="border-t border-line pt-3">
          <button type="button" onClick={() => setF(DEFAULT_FILTERS)} disabled={active === 0} className="text-meta text-muted underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink disabled:no-underline disabled:opacity-50">
            Clear filters
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mb-5 hidden items-center justify-between gap-4 border-b border-line pb-3 lg:flex">
          <span className="text-label font-medium uppercase text-muted tnum">
            <span className="text-ink">{shown.length}</span> of {items.length} roles &middot; by {f.sort === "new" ? "newest" : "match"}
          </span>
          <span className="flex items-center gap-4 text-[12px] text-faint">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] bg-stone" />In your graph</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] border border-line" />Missing</span>
          </span>
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={SearchX} title="No roles match these filters">Loosen a filter or discover more roles above.</EmptyState>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((item) => (
                <li key={item.job.id} className="min-w-0">
                  <BoardCard item={item} app={apps[item.job.id]} href={hrefFor(item.job.id)} />
                </li>
              ))}
            </ul>
            {shown.length > limit && (
              <div className="mt-8 flex items-center justify-between gap-4 border-t border-line pt-4">
                <span className="text-label font-medium uppercase text-muted tnum">Showing {visible.length} of {shown.length}</span>
                <button
                  type="button"
                  onClick={() => setPage({ key: params, n: limit + PAGE })}
                  className="group inline-flex h-9 items-center gap-2 rounded-full border border-line px-4 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-ink"
                >
                  Show {Math.min(PAGE, shown.length - limit)} more
                  <span aria-hidden="true" className="transition-transform duration-150 group-hover:translate-y-0.5">&darr;</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
