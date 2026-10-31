/**
 * The marketing site lives on its own domain (the nori-landing repo, https://norinote.xyz); this app is the dashboard.
 * "Home" links and signed-out visits to `/` go there.
 */
export const LANDING_URL = (process.env.NEXT_PUBLIC_LANDING_URL?.trim() || "https://norinote.xyz").replace(/\/+$/, "");
