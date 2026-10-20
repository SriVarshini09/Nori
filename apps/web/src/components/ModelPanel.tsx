"use client";

import { useState } from "react";
import { Check, KeyRound, Zap } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ModelMode, ModelProvider, ModelSettings, ModelTestResult } from "@/lib/types";
import { Button, Field, Frame, Icon, IndexLabel, Notice, Pill, TextLink, cx, idx, inputClass } from "./ui";

type ProviderDef = {
  id: ModelProvider;
  name: string;
  line: string;
  recommended?: boolean;
  needsKey: boolean;
  needsUrl: boolean;
  baseUrl: string;
  quality: string;
  bulk: string;
};

const PROVIDERS: ProviderDef[] = [
  { id: "cline", name: "Cline", line: "Uses your Cline credits, open models", recommended: true, needsKey: true, needsUrl: false, baseUrl: "https://api.cline.bot/api/v1", quality: "deepseek/deepseek-v4-pro", bulk: "qwen/qwen3.7-plus" },
  { id: "ollama", name: "Local Ollama", line: "Runs on your machine, no key", needsKey: false, needsUrl: true, baseUrl: "http://localhost:11434", quality: "qwen3:14b", bulk: "qwen3:4b" },
  { id: "openai-compatible", name: "Any OpenAI-compatible endpoint", line: "Your own gateway or provider", needsKey: true, needsUrl: true, baseUrl: "", quality: "", bulk: "" },
  { id: "anthropic", name: "Anthropic", line: "Claude models with your API key", needsKey: true, needsUrl: false, baseUrl: "", quality: "claude-sonnet-4-5", bulk: "claude-haiku-4-5" },
];

const MODE_LINE: Record<ModelMode, string> = {
  cline: "Running on open models via Cline",
  ollama: "Running locally on Ollama",
  "openai-compatible": "Running on your own endpoint",
  anthropic: "Running on Anthropic",
  heuristic: "No model: heuristics only",
};

const def = (id: ModelProvider) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

/** Model & keys. One numbered radio list, per-provider fields, Save and Test connection. Used in Settings and onboarding. */
export function ModelPanel({ initial, compact }: { initial: ModelSettings | null; compact?: boolean }) {
  const [saved, setSaved] = useState<ModelSettings | null>(initial);
  const start = initial?.provider ?? "cline";
  const [provider, setProvider] = useState<ModelProvider>(start);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? def(start).baseUrl);
  const [quality, setQuality] = useState(initial?.qualityModel ?? def(start).quality);
  const [bulk, setBulk] = useState(initial?.bulkModel ?? def(start).bulk);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<ModelTestResult | null>(null);

  const p = def(provider);
  const hasKey = !!saved?.hasKey && saved.provider === provider;

  function pick(id: ModelProvider) {
    if (id === provider) return;
    const d = def(id);
    setProvider(id);
    setApiKey("");
    setTest(null);
    setError(null);
    if (saved && saved.provider === id) {
      setBaseUrl(saved.baseUrl ?? d.baseUrl);
      setQuality(saved.qualityModel ?? d.quality);
      setBulk(saved.bulkModel ?? d.bulk);
    } else {
      setBaseUrl(d.baseUrl);
      setQuality(d.quality);
      setBulk(d.bulk);
    }
  }

  async function persist(): Promise<ModelSettings> {
    const next = await api.saveModelSettings({
      provider,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(p.needsUrl || provider === "cline" ? { baseUrl: baseUrl.trim() } : {}),
      qualityModel: quality.trim(),
      bulkModel: bulk.trim(),
    });
    setSaved(next);
    setApiKey("");
    return next;
  }

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.detail : (e as Error).message);

  async function save() {
    setBusy("save");
    setError(null);
    try { await persist(); } catch (e) { fail(e); } finally { setBusy(null); }
  }

  async function runTest() {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      await persist();
      setTest(await api.testModel());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const mode: ModelMode = saved?.mode ?? "heuristic";

  return (
    <Frame className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <IndexLabel marker={mode === "heuristic" ? "hollow" : "ink"} tone="ink">
          <span role="status">{MODE_LINE[mode]}</span>
        </IndexLabel>
        {provider === "cline" && !hasKey && (
          <TextLink href="https://cline.bot" external>Get a Cline key</TextLink>
        )}
      </div>

      <div role="radiogroup" aria-label="Model provider" className="mt-5 border-t border-line">
        {PROVIDERS.map((d, n) => {
          const on = d.id === provider;
          return (
            <div key={d.id} className="border-b border-line">
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(d.id)}
                className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 text-left transition-colors duration-150 hover:bg-stone/50 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:gap-x-4"
              >
                <span className="text-label font-medium text-faint tnum">{idx(n + 1)}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm font-medium text-ink">
                    {d.id === "cline" && <Icon icon={Zap} />}
                    {d.name}
                    {d.recommended && <Pill mark="accent" className="h-5 px-2 text-[11px]">Recommended</Pill>}
                  </span>
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

      <div className={cx("mt-5 grid gap-x-5 gap-y-5", !compact && "sm:grid-cols-2")}>
        {p.needsKey && (
          <Field label="API key" hint={hasKey ? "Key saved. Type to replace it." : undefined} className={compact ? "" : "sm:col-span-2"}>
            <span className="relative block">
              <input
                className={cx(inputClass, "pr-24")}
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? "" : provider === "cline" ? "Your Cline API key" : "API key"}
              />
              {hasKey && !apiKey && (
                <span className="pointer-events-none absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 text-[12px] text-muted"><Icon icon={KeyRound} />key saved</span>
              )}
            </span>
          </Field>
        )}
        {p.needsUrl && (
          <Field label="Base URL" className={compact ? "" : "sm:col-span-2"}>
            <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider === "ollama" ? "http://localhost:11434" : "https://example.com/v1"} spellCheck={false} />
          </Field>
        )}
        <Field label="Quality model">
          <input className={inputClass} value={quality} onChange={(e) => setQuality(e.target.value)} placeholder={p.quality || "Model id"} spellCheck={false} />
        </Field>
        <Field label="Bulk model">
          <input className={inputClass} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={p.bulk || "Model id"} spellCheck={false} />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button variant="primary" icon={Check} onClick={save} disabled={busy !== null}>{busy === "save" ? "Saving..." : "Save"}</Button>
        <Button variant="secondary" icon={Zap} onClick={runTest} disabled={busy !== null}>{busy === "test" ? "Testing..." : "Test connection"}</Button>
        {test?.ok && (
          <span className="text-meta text-ink tnum" role="status">
            {test.model} answered in {test.latencyMs} ms
          </span>
        )}
      </div>
      {test && !test.ok && <div className="mt-4"><Notice tone="red">{test.error ?? "The model did not answer."}</Notice></div>}
      {error && <div className="mt-4"><Notice tone="red">{error}</Notice></div>}
    </Frame>
  );
}
