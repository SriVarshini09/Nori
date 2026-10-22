import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate (Next 16 renamed middleware.ts to proxy.ts). No `jg_session` cookie -> /login.
 * The cookie is only checked for presence here; the API validates it, and the (app) layout sends a
 * rejected session back to /login and an unfinished onboarding to /onboarding.
 */
// Share images and the companion icon have no file extension, so the matcher catches them: they must stay public, or link
// previews in Slack, X and LinkedIn get a redirect to /login instead of an image.
const PUBLIC = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/privacy", "/terms", "/opengraph-image", "/twitter-image", "/icon", "/apple-icon", "/session-expired"];

/**
 * Requests the web app proxies to the API (/api, /mcp) carry the visitor's address, signed with PROXY_SECRET, so the API's
 * rate limits count per visitor and not per proxy. Without the secret the API keys on the nearest hop instead.
 */
function forwardToApi(req: NextRequest) {
  const secret = process.env.PROXY_SECRET;
  const headers = new Headers(req.headers);
  headers.delete("x-nori-proxy");
  headers.delete("x-nori-client-ip");
  if (secret) {
    // On Vercel (and most hosts) the platform sets X-Forwarded-For itself, so its first entry is the visitor.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim();
    if (ip) { headers.set("x-nori-proxy", secret); headers.set("x-nori-client-ip", ip); }
  }
  return NextResponse.next({ request: { headers } });
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/mcp" || pathname.startsWith("/mcp/")) return forwardToApi(req);
  // The landing page is public too; it sends signed-in visitors on to the dashboard itself.
  if (pathname === "/") return NextResponse.next();
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.get("jg_session")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/dashboard" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // everything except the API proxy, MCP, Next internals and files with an extension
  matcher: ["/((?!api|mcp|_next/static|_next/image|favicon.ico|.*\\..*).*)", "/api/:path*", "/mcp/:path*", "/mcp"],
};
