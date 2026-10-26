"use client";

import { Link2, Radar, Telescope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { BoardAts } from "@/lib/types";
import { Button, Field, Icon, Notice, cx, inputClass } from "./ui";

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
type Source = "board" | "link" | "describe";

const SOURCES: { id: Source; label: string; icon: typeof Radar }[] = [
  { id: "board", label: "Poll a board", icon: Radar },
  { id: "link", label: "Paste a link", icon: Link2 },
  { id: "describe", label: "Describe it", icon: Telescope },
];

const BOARDS: { id: BoardAts; label: string; hint: string }[] = [
  { id: "greenhouse", label: "Greenhouse", hint: "boards.greenhouse.io/vercel → vercel" },
  { id: "lever", label: "Lever", hint: "jobs.lever.co/netflix → netflix" },
  { id: "ashby", label: "Ashby", hint: "jobs.ashbyhq.com/linear → linear" },
  { id: "smartrecruiters", label: "SmartRecruiters", hint: "jobs.smartrecruiters.com/Visa → Visa" },
  { id: "workday", label: "Workday", hint: "tenant:shard:site e.g. nvidia:wd5:NVIDIAExternalCareerSite" },
  { id: "workable", label: "Workable", hint: "apply.workable.com/acme → acme" },
  { id: "rippling", label: "Rippling", hint: "ats.rippling.com/acme-jobs/jobs → acme-jobs" },
  { id: "recruitee", label: "Recruitee", hint: "acme.recruitee.com → acme" },
  { id: "bamboohr", label: "BambooHR", hint: "acme.bamboohr.com/careers → acme" },
  { id: "pinpoint", label: "Pinpoint", hint: "acme.pinpointhq.com → acme" },
  { id: "breezy", label: "Breezy HR", hint: "acme.breezy.hr → acme" },
  { id: "dover", label: "Dover", hint: "Company:board-uuid" },
  { id: "personio", label: "Personio", hint: "acme.jobs.personio.de → acme" },
];

/**
 * Where jobs come from: poll one company's public board, paste a single posting, or describe what you want and
 * let web search find it. Each tells you plainly what it added.
 */
export function DiscoverPanel() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("board");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "slate"; text: string } | null>(null);

  const [ats, setAts] = useState<BoardAts>("greenhouse");
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [objective, setObjective] = useState("");
  const [titles, setTitles] = useState("");
  const [locations, setLocations] = useState("");
  const [remote, setRemote] = useState(false);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ tone: "green", text: await fn() });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const poll = (e: React.FormEvent) => {
    e.preventDefault();
    const t = token.trim();
    if (!t) return;
    void run(async () => {
      const { added } = await api.pollFeed(ats, t);
      return added > 0 ? `Added ${added} new role${added === 1 ? "" : "s"} from ${t}.` : `No new roles on ${t}'s board since the last check.`;
    });
  };
  const addUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    void run(async () => {
      const { job } = await api.addJobByUrl(url.trim());
      setUrl("");
      return `Added "${job.title}" at ${job.companyName}.`;
    });
  };
  const discover = (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim()) return;
    void run(async () => {
      const res = await api.discoverJobs({ objective: objective.trim(), titles: split(titles), locations: split(locations), remote });
      return `Found ${res.jobs.length} role${res.jobs.length === 1 ? "" : "s"}, ${res.added} new.`;
    });
  };

  const board = BOARDS.find((b) => b.id === ats)!;
  return (
    <section aria-label="Add jobs" className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div role="tablist" aria-label="Where to find jobs" className="inline-flex flex-wrap gap-1 rounded-control bg-sunken p-1">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={source === s.id}
            onClick={() => { setSource(s.id); setMsg(null); }}
            className={cx("inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium", source === s.id ? "bg-surface text-ink shadow-[0_1px_2px_rgba(43,39,34,0.12)]" : "text-ink-2 hover:text-ink")}
          >
            <Icon icon={s.icon} size={14} /> {s.label}
          </button>
        ))}
      </div>

      {source === "board" && (
        <form onSubmit={poll} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Board" className="sm:w-48">
            <select className={inputClass} value={ats} onChange={(e) => setAts(e.target.value as BoardAts)}>
              {BOARDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </Field>
          <Field label="Company" hint={`From the board's address, e.g. ${board.hint}`} className="flex-1">
            <input className={inputClass} value={token} onChange={(e) => setToken(e.target.value)} placeholder="vercel" autoCapitalize="none" spellCheck={false} />
          </Field>
          <Button type="submit" variant="primary" disabled={busy || !token.trim()} className="sm:mb-[22px]">{busy ? "Fetching..." : "Fetch roles"}</Button>
        </form>
      )}

      {source === "link" && (
        <form onSubmit={addUrl} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Posting link" className="flex-1">
            <input className={inputClass} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/..." />
          </Field>
          <Button type="submit" variant="primary" disabled={busy || !url.trim()}>{busy ? "Adding..." : "Add job"}</Button>
        </form>
      )}

      {source === "describe" && (
        <form onSubmit={discover} className="mt-4 flex flex-col gap-3">
          <Field label="What are you looking for?">
            <textarea className={cx(inputClass, "resize-none")} rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Senior frontend roles at Series B startups, remote or San Francisco" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Titles"><input className={inputClass} value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="Staff Engineer, Frontend Lead" /></Field>
            <Field label="Places"><input className={inputClass} value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="San Francisco, New York" /></Field>
            <label className="flex h-10 items-center gap-2 whitespace-nowrap text-body-sm text-ink">
              <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} className="h-4 w-4" />
              Remote
            </label>
          </div>
          <div><Button type="submit" variant="primary" disabled={busy || !objective.trim()}>{busy ? "Searching..." : "Search the web"}</Button></div>
        </form>
      )}

      {msg && <div className="mt-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </section>
  );
}
