"use client";

import { useState } from "react";
import { Check, Minus, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import type { AgentStatus, Lane } from "@/lib/types";
import { ChipInput } from "../ChipInput";
import { Button, cx, Field, Frame, Icon, inputClass, Switch, Tag } from "../ui";

const REMOTE_LABEL: Record<Lane["remote"], string> = { only: "Remote only", ok: "Remote OK", no: "On-site only" };

/** Kept for older callers. */
export function SwitchButton({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <Switch checked={checked} onChange={onChange} label={label} />;
}

/** One shared cap for every lane: "N of M started today" with an editable M. */
export function CapFrame({ status, onStatus }: { status: AgentStatus; onStatus: (s: AgentStatus) => void }) {
  const [draft, setDraft] = useState(String(status.dailyCap));
  const [error, setError] = useState<string | null>(null);
  const cap = Math.max(status.dailyCap, 0);
  const fill = cap > 0 ? Math.min(100, (status.usedToday / cap) * 100) : 0;

  async function commit(value: number) {
    const n = Math.min(100, Math.max(0, Math.round(value) || 0));
    setDraft(String(n));
    if (n === status.dailyCap) return;
    const prev = status;
    onStatus({ ...status, dailyCap: n });
    setError(null);
    try {
      await api.updateProfile({ autoApplyDailyCap: n });
    } catch (e) {
      onStatus(prev);
      setDraft(String(prev.dailyCap));
      setError((e as Error).message);
    }
  }

  const step = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-control text-ink hover:bg-sunken disabled:pointer-events-none disabled:opacity-40";

  return (
    <Frame as="section" className="p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="text-body-sm font-semibold text-ink">Daily cap, shared by every lane</h2>
          <p className="mt-0.5 text-meta text-muted tnum">{status.usedToday} of {status.dailyCap} started today</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Lower the daily cap" className={step} disabled={status.dailyCap <= 0} onClick={() => commit(status.dailyCap - 1)}><Icon icon={Minus} /></button>
          <input
            aria-label="Daily cap"
            type="number"
            min={0}
            max={100}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(Number(draft))}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={cx(inputClass, "w-16 text-center tnum")}
          />
          <button type="button" aria-label="Raise the daily cap" className={step} disabled={status.dailyCap >= 100} onClick={() => commit(status.dailyCap + 1)}><Icon icon={Plus} /></button>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={status.usedToday} aria-label="Applications started today">
        <div className="h-full rounded-full bg-ink" style={{ width: `${fill}%` }} />
      </div>
      {status.dailyCap === 0 && <p className="mt-2 text-meta text-attn-fg">At 0, Nori starts nothing on its own. Raise it to turn auto apply on.</p>}
      {error && <p className="mt-2 text-meta text-danger-fg" role="alert">{error}</p>}
    </Frame>
  );
}

function LaneEditor({ lane, isNew, onSave, onCancel, onDelete }: { lane: Lane; isNew: boolean; onSave: (l: Lane) => void; onCancel: () => void; onDelete: () => void }) {
  const [d, setD] = useState(lane);
  const set = <K extends keyof Lane>(k: K, v: Lane[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ ...d, name: d.name.trim() || "Untitled lane" }); }}
      className="grid gap-x-5 gap-y-4 md:grid-cols-2"
    >
      <Field label="Name"><input className={inputClass} value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus={isNew} placeholder="Frontend, remote" /></Field>
      <Field label="Remote">
        <select className={inputClass} value={d.remote} onChange={(e) => set("remote", e.target.value as Lane["remote"])}>
          <option value="only">Remote only</option>
          <option value="ok">Remote OK</option>
          <option value="no">On-site only</option>
        </select>
      </Field>
      <div>
        <span className="mb-1.5 block text-meta font-medium text-ink-2">Titles</span>
        <ChipInput label="Titles" value={d.titles} onChange={(v) => set("titles", v)} placeholder="Senior Frontend Engineer" />
      </div>
      <div>
        <span className="mb-1.5 block text-meta font-medium text-ink-2">Places</span>
        <ChipInput label="Places" value={d.locations} onChange={(v) => set("locations", v)} placeholder="Anywhere" />
      </div>
      <Field label={<>Minimum match <span className="text-ink tnum">{pct(d.minScore)}%</span></>} hint="Jobs below this are skipped, and the reason is kept.">
        <input className="mt-2 w-full" type="range" min={0} max={100} step={5} value={pct(d.minScore)} onChange={(e) => set("minScore", Number(e.target.value) / 100)} />
      </Field>
      <div className="flex flex-wrap items-end justify-end gap-2 md:col-span-2">
        {!isNew && <Button variant="danger" icon={Trash2} onClick={onDelete} className="mr-auto">Delete lane</Button>}
        <Button variant="secondary" icon={X} onClick={onCancel}>Cancel</Button>
        <Button variant="primary" icon={Check} type="submit">Save lane</Button>
      </div>
    </form>
  );
}

export function LanesFrame({ lanes, status, onLanes }: { lanes: Lane[]; status: AgentStatus; onLanes: (l: Lane[]) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<Lane | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queued = (id: string) => status.lanes?.find((l) => l.id === id)?.queuedToday ?? 0;

  async function persist(next: Lane[]) {
    const prev = lanes;
    onLanes(next);
    setError(null);
    try {
      onLanes(await api.saveLanes(next));
    } catch (e) {
      onLanes(prev);
      setError((e as Error).message);
    }
  }

  function startAdd() {
    setEditing(null);
    setAdding({ id: `lane-${Date.now().toString(36)}`, name: "", titles: [], locations: [], remote: "ok", minScore: status.minScore || 0.75, enabled: true });
  }

  const all = adding ? [...lanes, adding] : lanes;

  return (
    <section aria-labelledby="lanes-h" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="lanes-h" className="text-title font-semibold text-ink">Lanes</h2>
        <Button variant="secondary" size="sm" icon={Plus} onClick={startAdd} disabled={!!adding}>Add a lane</Button>
      </div>
      {all.length === 0 && (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-body-sm text-muted">No lanes yet. Nori queues nothing on its own until it knows what you want.</p>
      )}
      <ul className="flex flex-col gap-2.5">
        {all.map((l) => {
          const isNew = adding?.id === l.id;
          const open = isNew || editing === l.id;
          return (
            <li key={l.id} className={cx("rounded-card border bg-surface p-4", open ? "border-ink" : "border-line")}>
              {open ? (
                <LaneEditor
                  lane={l}
                  isNew={isNew}
                  onCancel={() => (isNew ? setAdding(null) : setEditing(null))}
                  onDelete={() => { setEditing(null); void persist(lanes.filter((x) => x.id !== l.id)); }}
                  onSave={(next) => {
                    if (isNew) { setAdding(null); void persist([...lanes, next]); }
                    else { setEditing(null); void persist(lanes.map((x) => (x.id === next.id ? next : x))); }
                  }}
                />
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-start gap-3">
                    <Switch checked={l.enabled} label={`${l.name} lane ${l.enabled ? "on" : "off"}`} onChange={(v) => void persist(lanes.map((x) => (x.id === l.id ? { ...x, enabled: v } : x)))} />
                    <div className="min-w-0 flex-1">
                      <p className={cx("text-body-sm font-semibold", l.enabled ? "text-ink" : "text-muted")}>{l.name}</p>
                      <p className="mt-0.5 text-meta text-muted tnum">{REMOTE_LABEL[l.remote]} · minimum match {pct(l.minScore)}% · {l.enabled ? `${queued(l.id)} queued today` : "off"}</p>
                    </div>
                    <button type="button" aria-label={`Edit ${l.name}`} className="inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink" onClick={() => { setAdding(null); setEditing(l.id); }}>
                      <Icon icon={Pencil} size={14} /> Edit
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-[3.25rem]">
                    {l.titles.length === 0 ? <span className="text-meta text-muted">Any title</span> : l.titles.map((t) => <Tag key={t}>{t}</Tag>)}
                    <span className="mx-1 text-meta text-muted">in</span>
                    {l.locations.length === 0 ? <span className="text-meta text-muted">anywhere</span> : l.locations.map((t) => <Tag key={t}>{t}</Tag>)}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-meta text-danger-fg" role="alert">{error}</p>}
    </section>
  );
}
