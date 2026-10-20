export { extractResume, normalizeText, resumeFormat, SCANNED_PDF_ERROR, type ExtractedResume, type ExtractedLink } from "./extract-text.js";
export { extractContact, parseLocation, normalizeUrl, classifyUrl, canonicalCountry, type ContactInfo, type ContactField, type OtherLink } from "./contact.js";
export { sectionOf, type Section } from "./sections.js";
export { FONTS, FONT_IDS, isFontId, fontFaceCss, fontFiles, readFontFile, type FontId } from "./fonts.js";
export {
  DEFAULT_THEME, EXTRA_TITLES, PAGE_SIZES, SECTION_IDS, SECTION_TITLES, ThemeSchema, ResumeContentSchema, applyDensity, normalizeTheme, parseResumeContent,
  type PageSize, type ResumeTheme, type SectionId,
} from "./theme.js";
export {
  DEFAULT_FONT_BASE, TEMPLATES, TEMPLATE_IDS, isTemplateId, renderResumeHtml, resolveSections, themeFor,
  type RenderHtmlOptions, type TemplateId, type TemplateMeta,
} from "./templates.js";
export { fittingPlan, renderResume, type ResumeRenderOptions, type ResumeRenderOutcome } from "./render.js";
export { closeSharedBrowser } from "./browser.js";
export { displayUrl, hrefOf } from "./format.js";
export { SAMPLE_RESUME, SAMPLE_PERSONAS, STUDENT_RESUME, UNICODE_RESUME, longResume } from "./sample-content.js";
export {
  MAX_DOCS, MAX_VERSIONS, ResumeDocError, createBlankResumeDoc, createResumeDoc, createResumeDocFromGraph, deleteResumeDoc, duplicateResumeDoc, ensureResumeDoc,
  getDefaultResumeDoc, getResumeDoc, listResumeDocVersions, listResumeDocs, rebuildResumeDocFromGraph, restoreResumeDocVersion, setDefaultResumeDoc, updateResumeDoc,
  type NewResumeDoc, type ResumeDoc, type ResumeDocPatch, type ResumeDocVersion,
} from "./docs.js";
export { renderResumeDocx, renderResumeText, renderResumeJson, resumeFileBase } from "./export.js";
