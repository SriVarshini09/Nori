"use client";

import { Link2, Telescope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "./Panel";
import { Button, Field, Notice, cx, inputClass } from "./ui";

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** "Discover" (POST /api/jobs/discover) and "Add by URL" (POST /api/jobs/url). */
export function DiscoverPanel() {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [titles, setTitles] = useState("");
  const [locations, setLocations] = useState("");
  const [remote, setRemote] = useState(false);
  const [busy, setBusy] = useState<"discover" | "url" | null>(null);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [url, setUrl] = useState("");

  async function discover(e: React.FormEvent) {
    e.preventDefault();
    if (!objective.trim()) return;
    setBusy("discover");
    setMsg(null);
    try {
      const res = await api.discoverJobs({ objective: objective.trim(), titles: split(titles), locations: split(locations), remote });
      setMsg({ tone: "green", text: `Found ${res.jobs.length} jobs, ${res.added} new.` });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function addUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy("url");
    setMsg(null);
    try {
      const { job } = await api.addJobByUrl(url.trim());
      setMsg({ tone: "green", text: `Added "${job.title}" at ${job.companyName}.` });
      setUrl("");
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const sub = "inline-flex items-center gap-2 text-label font-medium uppercase text-muted";
  return (
    <Panel index="01" title="Find more roles">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-0">
        <form onSubmit={discover} className="space-y-4 lg:pr-8">
          <span className={sub}><span className="text-faint">A</span>Discover</span>
          <Field label="What are you looking for?">
            <textarea
              className={cx(inputClass, "resize-none")}
              rows={2}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Senior frontend roles at Series B startups, remote or SF"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Titles">
              <input className={inputClass} value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="Staff Engineer, Frontend Lead" />
            </Field>
            <Field label="Locations">
              <input className={inputClass} value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="San Francisco, New York" />
            </Field>
            <label className="flex h-9 items-center gap-2 whitespace-nowrap text-body-sm text-ink">
              <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} className="h-4 w-4" />
              Remote
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <span />
            <Button type="submit" variant="primary" icon={Telescope} disabled={busy !== null || !objective.trim()}>
              {busy === "discover" ? "Searching..." : "Discover"}
            </Button>
          </div>
        </form>
        <form onSubmit={addUrl} className="flex flex-col gap-4 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <span className={sub}><span className="text-faint">B</span>Add by URL</span>
          <Field label="Job posting link">
            <input className={inputClass} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/..." />
          </Field>
          <div className="mt-auto flex justify-end border-t border-line pt-4">
            <Button type="submit" icon={Link2} disabled={busy !== null || !url.trim()}>
              {busy === "url" ? "Adding..." : "Add job"}
            </Button>
          </div>
        </form>
      </div>
      {msg && <div className="mt-6"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </Panel>
  );
}
