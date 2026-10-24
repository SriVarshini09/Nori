"use client";

import { useState } from "react";
import { Check, KeyRound, ListRestart, Zap } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ModelMode, ModelPreset, ModelPresetsInfo, ModelSettings, ModelTestResult, ModelUsage } from "@/lib/types";
import { Button, Field, Frame, Icon, IndexLabel, Notice, TextLink, cx, idx, inputClass } from "./ui";

const MODE_LINE: Record<ModelMode, string> = {
  cline: "Running on open models via Cline",
  ollama: "Running locally",
  "openai-compatible": "Running on your own provider",
  anthropic: "Running on Anthropic",
  heuristic: "No model: heuristics only",
};

/**
 * Model and keys. Pick a provider, paste your own key, choose models from the provider's own list, test the connection.
 * Used in Settings and in onboarding (compact). Keys are sent to the server once and never shown again.
 */
export function ModelPanel({ initial, presets: info, compact }: { initial: ModelSettings | null; presets: ModelPresetsInfo; compact?: boolean }) {
  // Local models cannot be reached from a shared server, and LOCAL_ONLY forbids cloud ones: show only what can work.
  const offered = info.presets.filter((p) => (info.localOnly ? p.local : info.strictUrls ? !p.local : true));
  const byId = (id: string | null | undefined) => offered.find((p) => p.id === id);
  const startPreset = byId(initial?.preset) ?? offered[0];

  const [saved, setSaved] = useState<ModelSettings | null>(initial);
  const [preset, setPreset] = useState<ModelPreset | undefined>(startPreset);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? startPreset?.baseUrl ?? "");
  const [quality, setQuality] = useState(initial?.qualityModel ?? startPreset?.defaults?.quality ?? "");
  const [bulk, setBulk] = useState(initial?.bulkModel ?? startPreset?.defaults?.bulk ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "test" | "models" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [test, setTest] = useState<ModelTestResult | null>(null);

  if (!preset) return <Frame className="p-5 sm:p-6"><p className="text-body-sm text-muted">No model provider can be configured on this server.</p></Frame>;

  const hasKey = !!saved?.hasKey && saved.preset === preset.id;
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.detail : (e as Error).message);

  function pick(p: ModelPreset) {
    if (p.id === preset?.id) return;
    setPreset(p);
    setApiKey(""); setTest(null); setError(null); setNote(null); setModels([]);
    const same = saved?.preset === p.id;
    setBaseUrl(same ? saved?.baseUrl ?? p.baseUrl ?? "" : p.baseUrl ?? "");
    setQuality(same ? saved?.qualityModel ?? p.defaults?.quality ?? "" : p.defaults?.quality ?? "");
    setBulk(same ? saved?.bulkModel ?? p.defaults?.bulk ?? "" : p.defaults?.bulk ?? "");
  }

  const urlToSend = () => (preset!.provider === "anthropic" ? undefined : (preset!.editableUrl ? baseUrl.trim() : preset!.baseUrl) ?? undefined);

  async function persist(): Promise<ModelSettings> {
    const next = await api.saveModelSettings({
      provider: preset!.provider,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(urlToSend() ? { baseUrl: urlToSend() } : {}),
      qualityModel: quality.trim(),
      bulkModel: bulk.trim(),
    });
    setSaved(next);
    setApiKey("");
    return next;
  }

  async function save() {
    setBusy("save"); setError(null); setNote(null);
    try { await persist(); setNote("Saved."); } catch (e) { fail(e); } finally { setBusy(null); }
  }

  async function runTest() {
    setBusy("test"); setError(null); setNote(null); setTest(null);
    try { await persist(); setTest(await api.testModel()); } catch (e) { fail(e); } finally { setBusy(null); }
  }

  async function loadModels() {
    setBusy("models"); setError(null); setNote(null);
    try {
      const r = await api.listModels({ provider: preset!.provider, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), baseUrl: urlToSend() ?? null });
      setModels(r.models);
      setNote(`${r.models.length} models available. Start typing in a model box to pick one.`);
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  const mode: ModelMode = saved?.mode ?? "heuristic";
  const canList = preset.needsKey ? hasKey || apiKey.trim().length > 0 : true;
  const usageLine = usageText(saved?.usage);

  return (
    <Frame className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <IndexLabel marker={mode === "heuristic" ? "hollow" : "ink"} tone="ink">
          <span role="status">{MODE_LINE[mode]}</span>
        </IndexLabel>
        {preset.keyUrl && !hasKey && <TextLink href={preset.keyUrl} external>Get a {preset.label} key</TextLink>}
      </div>
      {usageLine && <p className={cx("mt-2 text-meta tnum", saved?.usage?.exhausted ? "text-accent-ink" : "text-muted")} role="status">{usageLine}</p>}

      <div role="radiogroup" aria-label="Model provider" className="mt-5 border-t border-line">
        {offered.map((d, n) => {
          const on = d.id === preset.id;
          return (
            <div key={d.id} className="border-b border-line">
              <button
                type="button" role="radio" aria-checked={on} onClick={() => pick(d)}
                className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 text-left transition-colors duration-150 hover:bg-stone/50 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:gap-x-4"
              >
                <span className="text-label font-medium text-faint tnum">{idx(n + 1)}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm font-medium text-ink">{d.label}</span>
                  <span className="mt-0.5 block text-meta text-muted">{d.line}</span>
                </span>
                <span aria-hidden="true" className={cx("flex h-4 w-4 items-center justify-center rounded-full border transition-colors duration-150", on ? "border-ink" : "border-line-strong")}>
                  {on && <span className="h-2 w-2 rounded-full bg-ink" />}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {info.strictUrls && <p className="mt-3 text-meta text-muted">Models on your own computer (Ollama, LM Studio) are not offered here, because this server cannot reach your computer. Run Nori on your computer to use them.</p>}

      <div className={cx("mt-5 grid gap-x-5 gap-y-5", !compact && "sm:grid-cols-2")}>
        {preset.needsKey && (
          <Field label="API key" hint={hasKey ? "Key saved. Type to replace it. It is stored encrypted and never shown again." : "Stored encrypted. Only used to call this provider for you."} className={compact ? "" : "sm:col-span-2"}>
            <span className="relative block">
              <input
                className={cx(inputClass, "pr-24")} type="password" autoComplete="new-password" spellCheck={false}
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasKey ? "" : "Paste your API key"}
              />
              {hasKey && !apiKey && (
                <span className="pointer-events-none absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 text-[12px] text-muted"><Icon icon={KeyRound} />key saved</span>
              )}
            </span>
          </Field>
        )}
        {preset.editableUrl && (
          <Field label="Base URL" className={compact ? "" : "sm:col-span-2"}>
            <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={preset.baseUrl ?? "https://example.com/v1"} spellCheck={false} />
          </Field>
        )}
        <Field label="Quality model" hint="Used for writing: tailoring and answers.">
          <input className={inputClass} list="model-options" value={quality} onChange={(e) => setQuality(e.target.value)} placeholder={preset.defaults?.quality ?? "Model name"} spellCheck={false} />
        </Field>
        <Field label="Bulk model" hint="Used for fast, cheap steps like reading and scoring.">
          <input className={inputClass} list="model-options" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={preset.defaults?.bulk ?? "Model name"} spellCheck={false} />
        </Field>
        <datalist id="model-options">{models.map((m) => <option key={m} value={m} />)}</datalist>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button variant="primary" icon={Check} onClick={save} disabled={busy !== null}>{busy === "save" ? "Saving..." : "Save"}</Button>
        <Button variant="secondary" icon={ListRestart} onClick={loadModels} disabled={busy !== null || !canList}>{busy === "models" ? "Loading..." : "Load models"}</Button>
        <Button variant="secondary" icon={Zap} onClick={runTest} disabled={busy !== null}>{busy === "test" ? "Testing..." : "Test connection"}</Button>
        {test?.ok && <span className="text-meta text-ink tnum" role="status">{test.model} answered in {test.latencyMs} ms</span>}
      </div>
      {note && !error && <p className="mt-4 text-meta text-muted" role="status">{note}</p>}
      {test && !test.ok && <div className="mt-4"><Notice tone="red">{test.error ?? "The model did not answer."}</Notice></div>}
      {error && <div className="mt-4"><Notice tone="red">{error}</Notice></div>}
    </Frame>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** One line on today's token use. On the shared key it also says how much of the daily allowance is left. */
function usageText(u: ModelUsage | undefined): string | null {
  if (!u) return null;
  if (u.shared && u.capTokens !== null) {
    if (u.exhausted) return `Shared key: today's allowance of ${fmt(u.capTokens)} tokens is used up. Nori writes with its rule-based fallback until midnight UTC; add your own key for no limit.`;
    return `Shared key: ${fmt(u.totalTokens)} of ${fmt(u.capTokens)} tokens used today. Resets at midnight UTC; add your own key for no limit.`;
  }
  if (u.totalTokens === 0) return null;
  return `${u.shared ? "Shared key" : "Your model"}: ${fmt(u.totalTokens)} tokens used today over ${u.calls} call${u.calls === 1 ? "" : "s"}.`;
}
