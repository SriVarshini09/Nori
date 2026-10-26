/** Class names shared by the public pages (landing, sign-in, account links). */

export const container = "mx-auto w-full max-w-[1160px] px-4 sm:px-6 lg:px-8";

const btn =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-all duration-150 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

/** Tactile Nori Emerald-to-Forest primary CTA button with warm specular top highlight. */
export const btnPrimary =
  `${btn} h-12 bg-[linear-gradient(180deg,#158f6a_0%,#0b664a_100%)] px-6 text-[15px] text-white ` +
  `shadow-[0_4px_14px_rgba(13,117,86,0.26),inset_0_1px_0_rgba(255,255,255,0.28)] hover:brightness-105 active:translate-y-px`;

/** Crisp white tactile secondary button. */
export const btnSecondary =
  `${btn} h-12 border border-control/60 bg-surface px-6 text-[15px] text-ink ` +
  `shadow-[0_1px_2px_rgba(19,28,24,0.05)] hover:bg-sunken/70 hover:border-control`;

export const btnSun = btnPrimary;

export const chip =
  "inline-flex items-center gap-2 rounded-full border border-[#bce6d1] bg-[#e6f8ef] px-3.5 py-1 text-[12.5px] font-semibold text-accent-fg shadow-2xs";

export const textLink =
  "font-semibold text-accent underline-offset-4 transition-colors hover:underline " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm";

export const field =
  "h-12 w-full rounded-control border border-control bg-surface pl-11 pr-4 text-[15px] text-ink placeholder:text-muted " +
  "shadow-[inset_0_1px_2px_rgba(19,28,24,0.03)] transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

export const fieldLabel = "mb-1.5 block text-[13px] font-semibold text-ink-2";
