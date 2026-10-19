"use client";

import { useState } from "react";
import { Check, Minus, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import type { AgentStatus, Lane } from "@/lib/types";
import { ChipInput } from "../ChipInput";
import { Button, cx, Field, Frame, Icon, IndexLabel, inputClass, Tag } from "../ui";

const REMOTE_LABEL: Record<Lane["remote"], string> = { only: "Remote only", ok: "Remote ok", no: "On-site only" };

export function SwitchButton({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative h-[18px] w-8 shrink-0 rounded-full border transition-colors duration-150", checked ? "border-ink bg-ink" : "border-line-strong bg-transparent")}
    >
      <span className={cx("absolute top-[2px] h-[12px] w-[12px] rounded-full transition-[left,background-color] duration-150 ease-[var(--ease)]", checked ? "left-[16px] bg-paper" : "left-[2px] bg-faint")} />
    </button>
  );
}

/** One shared cap for every lane: "N of M used today" with an editable M. */
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

  const step = "inline-flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink transition-colors duration-150 hover:border-ink disabled:pointer-events-none disabled:opacity-40";

  return (
    <Frame as="section">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 sm:p-5">
        <p className="min-w-0 text-body-sm text-muted tnum">
          <span className="font-display text-[1.75rem] font-medium leading-none tracking-[-0.03em] text-ink">{status.usedToday}</span>
          {" "}of {status.dailyCap} used today
        </p>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-label font-medium uppercase text-muted">Cap</span>
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
            className={cx(inputClass, "h-8 w-14 px-2 text-center tnum")}
          />
          <button type="button" aria-label="Raise the daily cap" className={step} disabled={status.dailyCap >= 100} onClick={() => commit(status.dailyCap + 1)}><Icon icon={Plus} /></button>
        </div>
      </div>
      <div className="mx-4 mb-4 h-[2px] bg-line sm:mx-5 sm:mb-5" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={status.usedToday} aria-label="Applications today">
        <div className="h-full bg-ink" style={{ width: `${fill}%` }} />
      </div>
      {error && <p className="border-t border-line px-4 py-3 text-meta text-accent-ink sm:px-5" role="alert">{error}</p>}
    </Frame>
  );
}

function LaneEditor({ lane, isNew, onSave, onCancel, onDelete }: { lane: Lane; isNew: boolean; onSave: (l: Lane) => void; onCancel: () => void; onDelete: () => void }) {
  const [d, setD] = useState(lane);
  const set = <K extends keyof Lane>(k: K, v: Lane[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ ...d, name: d.name.trim() || "Untitled lane" }); }}
      className="grid gap-x-5 gap-y-4 bg-stone/30 px-4 py-5 sm:px-5 md:grid-cols-2"
    >
      <Field label="Name"><input className={inputClass} value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus={isNew} placeholder="Frontend, remote" /></Field>
      <Field label="Remote">
        <select className={inputClass} value={d.remote} onChange={(e) => set("remote", e.target.value as Lane["remote"])}>
          <option value="only">Remote only</option>
          <option value="ok">Remote ok</option>
          <option value="no">On-site only</option>
        </select>
      </Field>
      <div>
        <span className="mb-1.5 block text-label font-medium uppercase text-muted">Titles</span>
        <ChipInput label="Titles" value={d.titles} onChange={(v) => set("titles", v)} placeholder="Senior Frontend Engineer" />
      </div>
      <div>
        <span className="mb-1.5 block text-label font-medium uppercase text-muted">Locations</span>
        <ChipInput label="Locations" value={d.locations} onChange={(v) => set("locations", v)} placeholder="Any" />
      </div>
      <Field label={<>Min score &middot; <span className="text-ink tnum">{pct(d.minScore)}%</span></>}>
        <input className="mt-3 w-full" type="range" min={0} max={100} step={5} value={pct(d.minScore)} onChange={(e) => set("minScore", Number(e.target.value) / 100)} />
      </Field>
      <div className="flex flex-wrap items-end justify-end gap-2 md:col-span-2">
        {!isNew && <Button variant="danger" icon={Trash2} onClick={onDelete} className="mr-auto">Delete</Button>}
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

  const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-muted transition-colors duration-150 hover:border-line hover:text-ink";
  const all = adding ? [...lanes, adding] : lanes;

  return (
    <Frame as="section">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-line px-4 sm:px-5">
        <IndexLabel index="01" marker tone="ink">Lanes</IndexLabel>
        <Button variant="secondary" icon={Plus} className="h-8 px-3" onClick={startAdd} disabled={!!adding}>Add lane</Button>
      </header>
      {all.length === 0 ? (
        <p className="px-4 py-8 text-center text-body-sm text-muted sm:px-5">No lanes yet.</p>
      ) : (
        <ol className="divide-y divide-line">
          {all.map((l, i) => {
            const isNew = adding?.id === l.id;
            const open = isNew || editing === l.id;
            const n = String(i + 1).padStart(2, "0");
            return (
              <li key={l.id}>
                {open ? (
                  <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] sm:grid-cols-[2.75rem_minmax(0,1fr)]">
                    <span className="pl-4 pt-5 text-label font-medium text-faint tnum sm:pl-5">{n}</span>
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
                  </div>
                ) : (
                  <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-4 sm:px-5 md:grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,2fr)_7rem_auto] md:items-center">
                    <span className="pt-[3px] text-label font-medium text-faint tnum md:pt-0">{n}</span>
                    <div className="min-w-0">
                      <div className={cx("truncate text-body-sm font-medium", l.enabled ? "text-ink" : "text-muted")}>{l.name}</div>
                      <div className="mt-0.5 text-meta text-muted tnum">{REMOTE_LABEL[l.remote]} &middot; min {pct(l.minScore)}%</div>
                    </div>
                    <div className="col-span-3 col-start-1 row-start-2 mt-3 min-w-0 space-y-1.5 md:col-span-1 md:col-start-3 md:row-start-1 md:mt-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {l.titles.length === 0 ? <span className="text-meta text-faint">Any title</span> : l.titles.map((t) => <Tag key={t}>{t}</Tag>)}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-faint">In</span>
                        {l.locations.length === 0 ? <span className="text-meta text-faint">Anywhere</span> : l.locations.map((t) => <Tag key={t} mark="hollow">{t}</Tag>)}
                      </div>
                    </div>
                    <div className="col-span-3 col-start-1 row-start-3 mt-2 whitespace-nowrap text-meta text-muted tnum md:col-span-1 md:col-start-4 md:row-start-1 md:mt-0 md:text-right">
                      <span className="text-ink">{queued(l.id)}</span> queued<span className="hidden sm:inline"> today</span>
                    </div>
                    <div className="col-start-3 row-start-1 flex items-center justify-end md:col-start-5">
                      <SwitchButton checked={l.enabled} label={`${l.enabled ? "Disable" : "Enable"} ${l.name}`} onChange={(v) => void persist(lanes.map((x) => (x.id === l.id ? { ...x, enabled: v } : x)))} />
                      <button type="button" aria-label={`Edit ${l.name}`} className={cx(iconBtn, "ml-2")} onClick={() => { setAdding(null); setEditing(l.id); }}><Icon icon={Pencil} /></button>
                      <button type="button" aria-label={`Delete ${l.name}`} className={iconBtn} onClick={() => void persist(lanes.filter((x) => x.id !== l.id))}><Icon icon={Trash2} /></button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {error && <p className="border-t border-line px-4 py-3 text-meta text-accent-ink sm:px-5" role="alert">{error}</p>}
    </Frame>
  );
}
