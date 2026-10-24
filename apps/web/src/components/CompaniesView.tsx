"use client";

import { Building2, Link2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { BoardAts, CompanyList, WatchedCompany } from "@/lib/types";
import { Button, EmptyState, Field, Frame, Icon, Notice, Pill, inputClass } from "./ui";

const ATS_LABEL: Record<BoardAts, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", smartrecruiters: "SmartRecruiters" };
const PAGE = 60;
const errorText = (e: unknown) => (e instanceof ApiError ? e.detail : (e as Error).message);

/** Watched companies: search, follow and unfollow, and add a company from its careers link. */
export function CompaniesView({ initial }: { initial: CompanyList }) {
  const [data, setData] = useState<CompanyList>(initial);
  const [q, setQ] = useState("");
  const [onlyFollowed, setOnlyFollowed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const seq = useRef(0);

  /** Reload the list for the given filters; a slower earlier answer never overwrites a newer one. */
  async function load(nextQ: string, followed: boolean, append = false) {
    const mine = ++seq.current;
    try {
      const res = await api.listCompanies({ q: nextQ, followed, limit: PAGE, offset: append ? data.companies.length : 0 });
      if (mine !== seq.current) return;
      setData(append ? { total: res.total, companies: [...data.companies, ...res.companies] } : res);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(errorText(e));
    }
  }

  async function toggle(c: WatchedCompany) {
    setBusy(c.id); setError(null);
    try {
      if (c.followed) await api.unfollowCompany(c.atsType, c.token); else await api.followCompany(c.atsType, c.token);
      if (onlyFollowed && c.followed) await load(q, true);
      else setData((d) => ({ ...d, companies: d.companies.map((x) => (x.id === c.id ? { ...x, followed: !c.followed } : x)) }));
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  }

  async function detect(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    setBusy("detect"); setError(null); setAdded(null);
    try {
      const r = await api.detectCompany(link.trim());
      setAdded(`Following ${r.name} on ${ATS_LABEL[r.atsType]}: ${r.openJobs} open role${r.openJobs === 1 ? "" : "s"}, ${r.added} new.`);
      setLink("");
      await load(q, onlyFollowed);
    } catch (e2) { setError(errorText(e2)); } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Icon icon={Search} size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search" aria-label="Search companies" placeholder="Search companies" value={q}
              onChange={(e) => { setQ(e.target.value); void load(e.target.value, onlyFollowed); }}
              className={`${inputClass} pl-10`}
            />
          </div>
          <button
            type="button" role="switch" aria-checked={onlyFollowed}
            onClick={() => { setOnlyFollowed(!onlyFollowed); void load(q, !onlyFollowed); }}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-[13px] font-medium text-ink transition-colors hover:border-ink aria-checked:border-ink aria-checked:bg-ink aria-checked:text-on-ink"
          >
            Following only
          </button>
        </div>
        <p className="mt-4 text-meta font-medium text-muted tnum" role="status">{data.total} {data.total === 1 ? "company" : "companies"}</p>

        {error && <div className="mt-4"><Notice tone="red">{error}</Notice></div>}

        {data.companies.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={Building2} title={onlyFollowed ? "You are not following anyone yet" : "No company matches"}>
              {onlyFollowed ? "Follow a company from the full list, or paste a careers link on the right." : "Try another name, or paste its careers link on the right."}
            </EmptyState>
          </div>
        ) : (
          <ul aria-label="Companies" className="mt-4 divide-y divide-line border-y border-line">
            {data.companies.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-ink">{c.name}</p>
                  <p className="text-meta text-muted">{ATS_LABEL[c.atsType]} &middot; {c.openJobs} open role{c.openJobs === 1 ? "" : "s"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {c.openJobs > 0 && <Link href={`/jobs?q=${encodeURIComponent(c.name)}`} className="text-meta font-medium text-ink underline decoration-control underline-offset-4 hover:decoration-ink">See roles</Link>}
                  <Button
                    type="button" variant={c.followed ? "primary" : "secondary"} disabled={busy !== null}
                    aria-pressed={c.followed} aria-label={`${c.followed ? "Unfollow" : "Follow"} ${c.name}`}
                    onClick={() => void toggle(c)}
                  >
                    {c.followed ? "Following" : "Follow"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {data.companies.length < data.total && (
          <div className="mt-6">
            <Button type="button" variant="secondary" onClick={() => void load(q, onlyFollowed, true)}>Show {Math.min(PAGE, data.total - data.companies.length)} more</Button>
          </div>
        )}
      </div>

      <aside aria-label="Add a company">
        <Frame className="p-5">
          <h2 className="text-title font-semibold text-ink">Add a company</h2>
          <p className="mt-1 text-meta text-muted">Paste its careers page or any job posting. Nori finds the job board behind it (Greenhouse, Lever, Ashby or SmartRecruiters), reads it and follows the company.</p>
          <form onSubmit={detect} className="mt-4 space-y-4">
            <Field label="Careers or job link">
              <input className={inputClass} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://example.com/careers" />
            </Field>
            <Button type="submit" variant="primary" icon={link.trim() ? Plus : Link2} disabled={busy !== null || !link.trim()}>
              {busy === "detect" ? "Looking..." : "Find and follow"}
            </Button>
          </form>
          {added && <div className="mt-4"><Notice tone="green">{added}</Notice></div>}
          <p className="mt-5 border-t border-line pt-4 text-meta text-muted">
            Not every company uses one of these boards. Workday and company-built career sites cannot be read yet; paste a direct job link to add a single role instead.
          </p>
          <div className="mt-3"><Pill mark="muted">Updated every few hours</Pill></div>
        </Frame>
      </aside>
    </div>
  );
}
