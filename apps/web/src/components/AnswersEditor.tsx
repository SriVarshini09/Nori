"use client";

import { useState, type ComponentType, type FormEvent } from "react";
import { Trash2, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Profile, SavedAnswersMap } from "@/lib/types";
import { AuthorizationStep, ContactStep, PreferencesStep, ScreeningStep, type StepProps } from "./onboarding/steps";
import { Accordion, Button, Field, Notice, inputClass } from "./ui";

function PreferencesAnswers(p: StepProps) {
  return <PreferencesStep {...p} agent={false} />;
}

const SECTIONS: { id: string; title: string; Form: ComponentType<StepProps> }[] = [
  { id: "contact", title: "Contact", Form: ContactStep },
  { id: "authorization", title: "Work authorization", Form: AuthorizationStep },
  { id: "screening", title: "Screening answers", Form: ScreeningStep },
  { id: "preferences", title: "Job preferences", Form: PreferencesAnswers },
];

function RememberedAnswersSection({
  initial,
  onChange,
}: {
  initial: SavedAnswersMap;
  onChange: (next: SavedAnswersMap) => void;
}) {
  const [saved, setSaved] = useState<SavedAnswersMap>(initial);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  const entries = Object.entries(saved);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || !newValue.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api.upsertSavedAnswer(newLabel.trim(), newValue.trim());
      setSaved(res.savedAnswers);
      onChange(res.savedAnswers);
      setNewLabel("");
      setNewValue("");
      setNote({ tone: "green", text: "Saved answer added." });
    } catch (err) {
      setNote({ tone: "red", text: err instanceof ApiError ? err.detail : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(key: string, label: string) {
    if (!editValue.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api.upsertSavedAnswer(label, editValue.trim());
      setSaved(res.savedAnswers);
      onChange(res.savedAnswers);
      setEditingKey(null);
      setNote({ tone: "green", text: "Answer updated." });
    } catch (err) {
      setNote({ tone: "red", text: err instanceof ApiError ? err.detail : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(key: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.deleteSavedAnswer(key);
      setSaved(res.savedAnswers);
      onChange(res.savedAnswers);
    } catch (err) {
      setNote({ tone: "red", text: err instanceof ApiError ? err.detail : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAll() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.clearSavedAnswers();
      setSaved(res.savedAnswers);
      onChange(res.savedAnswers);
      setNote({ tone: "green", text: "Cleared all remembered answers." });
    } catch (err) {
      setNote({ tone: "red", text: err instanceof ApiError ? err.detail : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-1">
      <p className="text-body-sm text-ink-2">
        Questions Nori could not answer on earlier forms that you answered once. Nori reuses these automatically whenever the same question appears again.
      </p>

      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      {entries.length > 0 ? (
        <ul className="divide-y divide-line rounded-card border border-line bg-bg">
          {entries.map(([key, item]) => (
            <li key={key} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{item.label}</p>
                {editingKey === key ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      aria-label={`Edit answer for ${item.label}`}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className={`${inputClass} max-w-xs`}
                    />
                    <Button type="button" size="sm" disabled={busy} onClick={() => handleSaveEdit(key, item.label)}>
                      Save
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setEditingKey(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[13.5px] text-ink-2">{item.value}</p>
                )}
              </div>
              {editingKey !== key && (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setEditingKey(key);
                      setEditValue(item.value);
                    }}
                  >
                    Edit
                  </Button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(key)}
                    aria-label={`Remove saved answer for ${item.label}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-danger"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-line px-4 py-3 text-meta text-muted">
          No remembered answers yet. Answer a pending question on an application or add one below.
        </p>
      )}

      <form onSubmit={handleAdd} className="grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Question label">
          <input
            className={inputClass}
            placeholder="e.g. Highest level of education"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
        </Field>
        <Field label="Your answer">
          <input
            className={inputClass}
            placeholder="e.g. Master's Degree"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={busy || !newLabel.trim() || !newValue.trim()}>
          <Plus size={15} aria-hidden="true" />
          Add answer
        </Button>
      </form>

      {entries.length > 1 && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={handleClearAll}>
            Clear all ({entries.length})
          </Button>
        </div>
      )}
    </div>
  );
}

function ProjectsSection() {
  const [name, setName] = useState("");
  const [tech, setTech] = useState("");
  const [link, setLink] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function handleAddProject(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !outcome.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const sentence = [
        `Built project "${name.trim()}"`,
        tech.trim() ? `using ${tech.trim()}` : "",
        link.trim() ? `(${link.trim()})` : "",
        `: ${outcome.trim()}`,
      ]
        .filter(Boolean)
        .join(" ");
      const res = await api.addFact(sentence);
      setName("");
      setTech("");
      setLink("");
      setOutcome("");
      setNote({ tone: "green", text: `Added project to your career graph (${res.nodesCreated} fact node(s) created).` });
    } catch (err) {
      setNote({ tone: "red", text: err instanceof ApiError ? err.detail : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleAddProject} className="flex flex-col gap-4 pt-1">
      <p className="text-body-sm text-ink-2">
        Add projects with their tech stack, link, and measurable outcome. Each project is added to your Career Graph so Nori can cite it in tailored resumes and form answers.
      </p>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Project name">
          <input
            className={inputClass}
            placeholder="e.g. Distributed Cache Engine"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Tech tags">
          <input
            className={inputClass}
            placeholder="e.g. Rust, Redis, gRPC"
            value={tech}
            onChange={(e) => setTech(e.target.value)}
          />
        </Field>
        <Field label="GitHub or live link (optional)">
          <input
            className={inputClass}
            placeholder="https://github.com/..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </Field>
      </div>
      <Field label="What you built & measurable result">
        <input
          className={inputClass}
          placeholder="e.g. Cut p99 read latency by 38% across 10k requests/sec"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={busy || !name.trim() || !outcome.trim()}>
          <Plus size={15} aria-hidden="true" />
          {busy ? "Adding to graph..." : "Add project to graph"}
        </Button>
      </div>
    </form>
  );
}

/** The onboarding answers, editable after the fact. Each section saves through PUT /api/profile. */
export function AnswersEditor({ profile: initial }: { profile: Profile }) {
  const [profile, setProfile] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; tone: "green" | "red"; text: string } | null>(null);

  async function save(id: string, data: Record<string, unknown>) {
    setBusy(id);
    setNote(null);
    try {
      const saved = await api.updateProfile(data as Parameters<typeof api.updateProfile>[0]);
      setProfile((p) => ({ ...p, ...data, ...(saved ?? {}) }) as Profile);
      setNote({ id, tone: "green", text: "Saved." });
    } catch (e) {
      setNote({ id, tone: "red", text: e instanceof ApiError ? e.detail : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const savedCount = Object.keys(profile.preferences?.savedAnswers ?? {}).length;

  return (
    <div className="flex flex-col gap-3">
      {SECTIONS.map(({ id, title, Form }, i) => (
        <Accordion key={id} title={title} defaultOpen={i === 0}>
          <div className="pt-1">
            <Form
              profile={profile}
              busy={busy === id}
              submitLabel="Save"
              onSubmit={(d) => save(id, d)}
              status={note?.id === id ? <Notice tone={note.tone}>{note.text}</Notice> : undefined}
            />
          </div>
        </Accordion>
      ))}
      <Accordion title="Projects and portfolio">
        <ProjectsSection />
      </Accordion>
      <Accordion title={savedCount > 0 ? `Remembered form answers (${savedCount})` : "Remembered form answers"}>
        <RememberedAnswersSection
          initial={profile.preferences?.savedAnswers ?? {}}
          onChange={(savedAnswers) =>
            setProfile((p) => ({ ...p, preferences: { ...p.preferences, savedAnswers } }))
          }
        />
      </Accordion>
    </div>
  );
}
