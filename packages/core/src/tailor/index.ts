import type { TailorInput } from "../contracts.js";
import { tailorResume, type TailorOutcome } from "./rewrite.js";
import { renderPdf, type RenderOutcome } from "./pdf.js";

export * from "./rewrite.js";
export * from "./template.js";
export * from "./pdf.js";
export * from "./ats.js";
export { ACTION_VERBS, startsWithVerb, strengthenOpener } from "./verbs.js";

export type TailorAndRenderResult = { tailor: TailorOutcome; render: RenderOutcome };

/** Tailor the baseline to the job, then render a fitted one-page PDF at outPath. */
export async function tailorAndRender(input: TailorInput, outPath: string): Promise<TailorAndRenderResult> {
  const tailor = await tailorResume(input);
  const render = await renderPdf(tailor.content, outPath, { requirements: input.requirements });
  return { tailor, render };
}
export * from "./recruiter.js";
