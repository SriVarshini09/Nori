"use client";

import { Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Preferences, Profile } from "@/lib/types";
import { Button, Field, Frame, IndexLabel, Notice, Toggle, inputClass } from "./ui";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Form section on the 12-column grid: label + note on the left (3), framed fields on the right (9). */
function FormSection({ index, label, note, children }: { index: string; label: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-12 gap-x-6 gap-y-4 border-t border-line pt-4">
      <div className="col-span-12 lg:col-span-3">
        <IndexLabel index={index} marker tone="ink">{label}</IndexLabel>
        {note && <p className="mt-3 max-w-[30ch] text-meta text-muted">{note}</p>}
      </div>
      <Frame className="col-span-12 p-5 sm:p-6 lg:col-span-9">{children}</Frame>
    </section>
  );
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const [f, setF] = useState({
    fullName: profile.fullName ?? "",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    linkedin: profile.linkedin ?? "",
    website: profile.website ?? "",
    location: profile.location ?? "",
  });
  const [prefs, setPrefs] = useState({
    titles: (profile.preferences.titles ?? []).join(", "),
    locations: (profile.preferences.locations ?? []).join(", "),
    remote: profile.preferences.remote ?? "ok",
    salaryMin: profile.preferences.salaryMin?.toString() ?? "",
    stages: (profile.preferences.stages ?? []).join(", "),
    excludeCompanies: (profile.preferences.excludeCompanies ?? []).join(", "),
  });
  const [auth, setAuth] = useState({
    authorizedUS: !!profile.workAuth.authorizedUS,
    needsSponsorship: !!profile.workAuth.needsSponsorship,
    notes: profile.workAuth.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const preferences: Preferences = {
      titles: list(prefs.titles),
      locations: list(prefs.locations),
      remote: prefs.remote as Preferences["remote"],
      salaryMin: prefs.salaryMin ? Number(prefs.salaryMin) : undefined,
      stages: list(prefs.stages),
      excludeCompanies: list(prefs.excludeCompanies),
    };
    try {
      await api.updateProfile({ ...f, workAuth: { ...profile.workAuth, ...auth }, preferences });
      setNote({ tone: "green", text: "Profile saved." });
    } catch (err) {
      setNote({ tone: "red", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const text = (k: keyof typeof f, label: string, type = "text") => (
    <Field label={label}>
      <input className={inputClass} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );

  return (
    <form onSubmit={save} className="space-y-16">
      <FormSection index="01" label="Contact details">
        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
          {text("fullName", "Full name")}
          {text("email", "Email", "email")}
          {text("phone", "Phone", "tel")}
          {text("location", "Location")}
          {text("linkedin", "LinkedIn URL", "url")}
          {text("website", "Website", "url")}
        </div>
      </FormSection>

      <FormSection index="02" label="Job preferences">
        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
          <Field label="Target titles" hint="Comma separated">
            <input className={inputClass} value={prefs.titles} onChange={(e) => setPrefs({ ...prefs, titles: e.target.value })} />
          </Field>
          <Field label="Locations" hint="Comma separated">
            <input className={inputClass} value={prefs.locations} onChange={(e) => setPrefs({ ...prefs, locations: e.target.value })} />
          </Field>
          <Field label="Remote">
            <select className={inputClass} value={prefs.remote} onChange={(e) => setPrefs({ ...prefs, remote: e.target.value as "only" | "ok" | "no" })}>
              <option value="only">Remote only</option>
              <option value="ok">Remote is fine</option>
              <option value="no">On-site or hybrid only</option>
            </select>
          </Field>
          <Field label="Minimum salary (USD)">
            <input className={`${inputClass} tnum`} type="number" min={0} step={5000} value={prefs.salaryMin} onChange={(e) => setPrefs({ ...prefs, salaryMin: e.target.value })} />
          </Field>
          <Field label="Company stages" hint="Comma separated, e.g. Series A, Series B">
            <input className={inputClass} value={prefs.stages} onChange={(e) => setPrefs({ ...prefs, stages: e.target.value })} />
          </Field>
          <Field label="Exclude companies" hint="Comma separated">
            <input className={inputClass} value={prefs.excludeCompanies} onChange={(e) => setPrefs({ ...prefs, excludeCompanies: e.target.value })} />
          </Field>
        </div>
      </FormSection>

      <FormSection index="03" label="Work authorization">
        <div className="-mt-4 divide-y divide-line">
          <Toggle label="Authorized to work in the US" checked={auth.authorizedUS} onChange={(v) => setAuth({ ...auth, authorizedUS: v })} />
          <Toggle label="Requires visa sponsorship" checked={auth.needsSponsorship} onChange={(v) => setAuth({ ...auth, needsSponsorship: v })} />
        </div>
        <Field label="Notes" className="mt-2 border-t border-line pt-5">
          <input className={inputClass} value={auth.notes} onChange={(e) => setAuth({ ...auth, notes: e.target.value })} placeholder="e.g. US citizen, open to relocation" />
        </Field>
      </FormSection>

      <div className="grid grid-cols-12 gap-x-6 border-t border-line pt-6">
        <div className="col-span-12 flex flex-wrap items-center gap-4 lg:col-span-9 lg:col-start-4">
          <Button type="submit" variant="primary" icon={Check} disabled={busy}>{busy ? "Saving..." : "Save profile"}</Button>
          {note && <div className="min-w-0 flex-1"><Notice tone={note.tone}>{note.text}</Notice></div>}
        </div>
      </div>
    </form>
  );
}
