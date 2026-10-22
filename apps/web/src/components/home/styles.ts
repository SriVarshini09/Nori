/** Class names shared by the public pages (landing, sign-in, account links). Solid colours only. */

export const container = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8";

const btn =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-150 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun disabled:cursor-not-allowed disabled:opacity-60";

/** Dark brown button on light backgrounds. */
export const btnPrimary = `${btn} h-12 bg-brand px-6 text-[15px] text-white hover:bg-brand-hover`;
/** White button with a hairline, beside a primary one. */
export const btnSecondary = `${btn} h-12 border border-rule bg-white px-6 text-[15px] text-bark hover:border-rule-strong`;
/** Sunny button with dark text, for dark backgrounds. */
export const btnSun = `${btn} h-12 bg-sun px-6 text-[15px] text-bark hover:bg-sun-hover`;

export const chip = "inline-flex items-center gap-2 rounded-full bg-sun-soft px-3 py-1 text-[12.5px] font-semibold text-bark-2";

export const textLink =
  "font-semibold text-brand underline decoration-rule-strong underline-offset-4 transition-colors hover:decoration-brand " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun rounded-sm";

/** Text inputs with a leading icon (the icon sits at left-4, so the text starts at pl-11). */
export const field =
  "h-12 w-full rounded-xl border border-rule bg-white pl-11 pr-4 text-[15px] text-bark placeholder:text-bark-3 " +
  "transition-colors duration-150 hover:border-rule-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-sun";

export const fieldLabel = "mb-1.5 block text-[13px] font-semibold text-bark-2";
