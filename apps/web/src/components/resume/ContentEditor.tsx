"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ResumeBullet, ResumeContent } from "@/lib/types";
import { ChipInput } from "../ChipInput";
import { Button, Field, Icon, inputClass, cx } from "../ui";
import {
  EXTRA_TITLES, SECTION_TITLES, blankGroup, blankProject, blankRole, blankSchool, move, newId, sectionState, withSections, type SectionId,
} from "./model";

type Props = { content: ResumeContent; onChange: (c: ResumeContent) => void };

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink transition-colors hover:border-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Block({ id, title, hint, actions, children }: { id: string; title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`h-${id}`} className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`h-${id}`} className="font-display text-title font-medium text-ink">{title}</h3>
          {hint && <p className="mt-0.5 text-meta text-muted">{hint}</p>}
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function BulletList({ idPrefix, bullets, onChange, label }: { idPrefix: string; bullets: ResumeBullet[]; onChange: (b: ResumeBullet[]) => void; label: string }) {
  const set = (i: number, text: string) => onChange(bullets.map((b, k) => (k === i ? { ...b, text, edited: b.nodeIds.length ? true : b.edited } : b)));
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label={label}>
        {bullets.map((b, i) => {
          const n = wordCount(b.text);
          const off = b.text.trim() !== "" && (n < 8 || n > 30);
          return (
            <li key={b.id} className="flex gap-2">
              <div className="min-w-0 flex-1">
                <textarea
                  aria-label={`${label} bullet ${i + 1}`} rows={2} value={b.text} maxLength={600}
                  onChange={(e) => set(i, e.target.value)} className={cx(inputClass, "resize-y leading-snug")} placeholder="Start with a verb: what you did, and the result"
                />
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-faint">
                  <span className={off ? "text-accent-ink" : ""}>{n} words{off ? (n < 8 ? " (aim for 8 to 30)" : " (long: aim for 8 to 30)") : ""}</span>
                  {b.edited && <span>edited by you</span>}
                  {!b.edited && b.nodeIds.length > 0 && <span>from your career graph</span>}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <IconButton label={`Move ${label} bullet ${i + 1} up`} onClick={() => onChange(move(bullets, i, i - 1))} disabled={i === 0}><Icon icon={ArrowUp} /></IconButton>
                <IconButton label={`Move ${label} bullet ${i + 1} down`} onClick={() => onChange(move(bullets, i, i + 1))} disabled={i === bullets.length - 1}><Icon icon={ArrowDown} /></IconButton>
                <IconButton label={`Remove ${label} bullet ${i + 1}`} onClick={() => onChange(bullets.filter((_, k) => k !== i))}><Icon icon={Trash2} /></IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="secondary" icon={Plus} onClick={() => onChange([...bullets, { id: newId(idPrefix), text: "", nodeIds: [] }])}>Add bullet</Button>
    </div>
  );
}

export function ContentEditor({ content, onChange }: Props) {
  const edit = (fn: (d: ResumeContent) => void) => { const d = structuredClone(content); fn(d); onChange(d); };
  const sections = sectionState(content);
  const usedExtras = new Set((content.extras ?? []).map((x) => x.title));
  const freeExtras = EXTRA_TITLES.filter((t) => !usedExtras.has(t));

  const sectionBody: Record<SectionId, ReactNode> = {
    summary: (
      <Field label="Summary" hint={`${(content.summary ?? "").length}/1200 characters. Two or three lines work best.`}>
        <textarea aria-label="Summary" rows={4} maxLength={1200} className={cx(inputClass, "resize-y")} value={content.summary ?? ""} onChange={(e) => edit((d) => { d.summary = e.target.value; })} />
      </Field>
    ),
    experience: (
      <>
        {content.experience.map((r, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-line p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label font-medium uppercase text-muted">Role {i + 1}</span>
              <div className="flex gap-1.5">
                <IconButton label={`Move role ${i + 1} up`} disabled={i === 0} onClick={() => edit((d) => { d.experience = move(d.experience, i, i - 1); })}><Icon icon={ArrowUp} /></IconButton>
                <IconButton label={`Move role ${i + 1} down`} disabled={i === content.experience.length - 1} onClick={() => edit((d) => { d.experience = move(d.experience, i, i + 1); })}><Icon icon={ArrowDown} /></IconButton>
                <IconButton label={`Remove role ${i + 1}`} onClick={() => edit((d) => { d.experience.splice(i, 1); })}><Icon icon={Trash2} /></IconButton>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Job title"><input className={inputClass} value={r.title} maxLength={160} onChange={(e) => edit((d) => { d.experience[i].title = e.target.value; })} /></Field>
              <Field label="Company"><input className={inputClass} value={r.company} maxLength={160} onChange={(e) => edit((d) => { d.experience[i].company = e.target.value; })} /></Field>
              <Field label="Location"><input className={inputClass} value={r.location ?? ""} maxLength={160} onChange={(e) => edit((d) => { d.experience[i].location = e.target.value; })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><input className={inputClass} placeholder="Mar 2022" value={r.start ?? ""} maxLength={40} onChange={(e) => edit((d) => { d.experience[i].start = e.target.value; })} /></Field>
                <Field label="End"><input className={inputClass} placeholder="Present" value={r.end ?? ""} maxLength={40} onChange={(e) => edit((d) => { d.experience[i].end = e.target.value; })} /></Field>
              </div>
            </div>
            <BulletList idPrefix={`e${i}`} label={`Role ${i + 1}`} bullets={r.bullets} onChange={(b) => edit((d) => { d.experience[i].bullets = b; })} />
          </div>
        ))}
        <Button type="button" variant="secondary" icon={Plus} onClick={() => edit((d) => { d.experience.push(blankRole()); })}>Add role</Button>
      </>
    ),
    education: (
      <>
        {content.education.map((e, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-line p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label font-medium uppercase text-muted">School {i + 1}</span>
              <IconButton label={`Remove school ${i + 1}`} onClick={() => edit((d) => { d.education.splice(i, 1); })}><Icon icon={Trash2} /></IconButton>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="School"><input className={inputClass} value={e.school} maxLength={200} onChange={(ev) => edit((d) => { d.education[i].school = ev.target.value; })} /></Field>
              <Field label="Degree"><input className={inputClass} placeholder="B.S." value={e.degree ?? ""} maxLength={160} onChange={(ev) => edit((d) => { d.education[i].degree = ev.target.value; })} /></Field>
              <Field label="Field of study"><input className={inputClass} value={e.field ?? ""} maxLength={160} onChange={(ev) => edit((d) => { d.education[i].field = ev.target.value; })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><input className={inputClass} placeholder="2013" value={e.start ?? ""} maxLength={40} onChange={(ev) => edit((d) => { d.education[i].start = ev.target.value; })} /></Field>
                <Field label="End"><input className={inputClass} placeholder="2017" value={e.end ?? ""} maxLength={40} onChange={(ev) => edit((d) => { d.education[i].end = ev.target.value; })} /></Field>
              </div>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" icon={Plus} onClick={() => edit((d) => { d.education.push(blankSchool()); })}>Add school</Button>
      </>
    ),
    skills: (
      <>
        {content.skills.map((g, i) => (
          <div key={i} className="grid items-start gap-3 sm:grid-cols-[12rem_1fr_auto]">
            <Field label="Group"><input className={inputClass} placeholder="Languages" value={g.group} maxLength={80} onChange={(e) => edit((d) => { d.skills[i].group = e.target.value; })} /></Field>
            <div>
              <span className="mb-1.5 block text-label font-medium uppercase text-muted">Skills</span>
              <ChipInput label={`Skills in group ${i + 1}`} placeholder="Type a skill, press Enter" value={g.items} onChange={(v) => edit((d) => { d.skills[i].items = v; })} />
            </div>
            <div className="pt-6"><IconButton label={`Remove skill group ${i + 1}`} onClick={() => edit((d) => { d.skills.splice(i, 1); })}><Icon icon={Trash2} /></IconButton></div>
          </div>
        ))}
        <Button type="button" variant="secondary" icon={Plus} onClick={() => edit((d) => { d.skills.push(blankGroup()); })}>Add skill group</Button>
      </>
    ),
    projects: (
      <>
        {(content.projects ?? []).map((p, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-line p-3 sm:p-4">
            <div className="flex items-end gap-2">
              <Field label="Project name" className="flex-1"><input className={inputClass} value={p.name} maxLength={160} onChange={(e) => edit((d) => { d.projects![i].name = e.target.value; })} /></Field>
              <IconButton label={`Remove project ${i + 1}`} onClick={() => edit((d) => { d.projects!.splice(i, 1); })}><Icon icon={Trash2} /></IconButton>
            </div>
            <BulletList idPrefix={`p${i}`} label={`Project ${i + 1}`} bullets={p.bullets} onChange={(b) => edit((d) => { d.projects![i].bullets = b; })} />
          </div>
        ))}
        <Button type="button" variant="secondary" icon={Plus} onClick={() => edit((d) => { (d.projects ??= []).push(blankProject()); })}>Add project</Button>
      </>
    ),
    certifications: (
      <Field label="Certifications" hint="One per line.">
        <textarea aria-label="Certifications" rows={3} className={cx(inputClass, "resize-y")} value={(content.certifications ?? []).join("\n")} onChange={(e) => edit((d) => { d.certifications = e.target.value.split("\n"); })} />
      </Field>
    ),
  };

  return (
    <div className="space-y-4">
      <Block id="contact" title="Contact" hint="Shown at the top. Email and a phone or LinkedIn help applicant systems.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" className="sm:col-span-2"><input className={inputClass} value={content.name} maxLength={120} onChange={(e) => edit((d) => { d.name = e.target.value; })} /></Field>
          <Field label="Email"><input className={inputClass} type="email" value={content.contact.email ?? ""} maxLength={200} onChange={(e) => edit((d) => { d.contact.email = e.target.value; })} /></Field>
          <Field label="Phone"><input className={inputClass} type="tel" value={content.contact.phone ?? ""} maxLength={60} onChange={(e) => edit((d) => { d.contact.phone = e.target.value; })} /></Field>
          <Field label="Location"><input className={inputClass} value={content.contact.location ?? ""} maxLength={160} onChange={(e) => edit((d) => { d.contact.location = e.target.value; })} /></Field>
          <Field label="LinkedIn"><input className={inputClass} placeholder="linkedin.com/in/you" value={content.contact.linkedin ?? ""} maxLength={300} onChange={(e) => edit((d) => { d.contact.linkedin = e.target.value; })} /></Field>
          <Field label="GitHub"><input className={inputClass} placeholder="github.com/you" value={content.contact.github ?? ""} maxLength={300} onChange={(e) => edit((d) => { d.contact.github = e.target.value; })} /></Field>
          <Field label="Website"><input className={inputClass} placeholder="you.dev" value={content.contact.website ?? ""} maxLength={300} onChange={(e) => edit((d) => { d.contact.website = e.target.value; })} /></Field>
        </div>
      </Block>

      <Block id="sections" title="Sections" hint="Reorder or hide sections. Hidden sections stay in your document but do not print.">
        <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Section order">
          {sections.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2">
              <span className={cx("flex-1 text-body-sm", s.hidden ? "text-faint line-through" : "text-ink")}>{SECTION_TITLES[s.id]}{s.hidden ? " (hidden)" : ""}</span>
              <IconButton label={`Move ${SECTION_TITLES[s.id]} up`} disabled={i === 0} onClick={() => onChange(withSections(content, move(sections, i, i - 1)))}><Icon icon={ArrowUp} /></IconButton>
              <IconButton label={`Move ${SECTION_TITLES[s.id]} down`} disabled={i === sections.length - 1} onClick={() => onChange(withSections(content, move(sections, i, i + 1)))}><Icon icon={ArrowDown} /></IconButton>
              <IconButton label={s.hidden ? `Show ${SECTION_TITLES[s.id]}` : `Hide ${SECTION_TITLES[s.id]}`} onClick={() => onChange(withSections(content, sections.map((x) => (x.id === s.id ? { ...x, hidden: !x.hidden } : x))))}>
                <Icon icon={s.hidden ? EyeOff : Eye} />
              </IconButton>
            </li>
          ))}
        </ul>
      </Block>

      {sections.map((s) => (
        <Block key={s.id} id={s.id} title={SECTION_TITLES[s.id]}>
          {s.hidden && <p className="rounded-lg bg-stone/60 px-3 py-2 text-meta text-muted">This section is hidden and will not print. You can still edit it.</p>}
          {sectionBody[s.id]}
        </Block>
      ))}

      {(content.extras ?? []).map((x, i) => (
        <Block key={x.title} id={`extra-${i}`} title={x.title} actions={<IconButton label={`Remove ${x.title}`} onClick={() => edit((d) => { d.extras!.splice(i, 1); })}><Icon icon={Trash2} /></IconButton>}>
          <Field label={x.title} hint="One per line.">
            <textarea aria-label={x.title} rows={3} className={cx(inputClass, "resize-y")} value={x.items.join("\n")} onChange={(e) => edit((d) => { d.extras![i].items = e.target.value.split("\n"); })} />
          </Field>
        </Block>
      ))}

      {freeExtras.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-meta text-muted">Add a section:</span>
          {freeExtras.map((t) => (
            <Button key={t} type="button" variant="secondary" icon={Plus} onClick={() => edit((d) => { (d.extras ??= []).push({ title: t, items: [""] }); })}>{t}</Button>
          ))}
        </div>
      )}
    </div>
  );
}
