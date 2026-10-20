import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate (Next 16 renamed middleware.ts to proxy.ts). No `jg_session` cookie -> /login.
 * The cookie is only checked for presence here; the API validates it, and the (app) layout sends a
 * rejected session back to /login and an unfinished onboarding to /onboarding.
 */
const PUBLIC = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.get("jg_session")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" || pathname === "/dashboard" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // everything except the API proxy, MCP, Next internals and files with an extension
  matcher: ["/((?!api|mcp|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
