import { NextResponse, type NextRequest } from "next/server";

/**
 * Where a rejected session goes. Server components cannot clear a cookie, and a stale `jg_session` kept bouncing the
 * landing page to /dashboard and back to /login. This drops the cookie and sends the person to sign in, keeping where
 * they were (same-site paths only).
 */
export function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("next") ?? "";
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "";
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = next && next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : "";
  const res = NextResponse.redirect(url);
  res.cookies.set("jg_session", "", { path: "/", maxAge: 0 });
  return res;
}
