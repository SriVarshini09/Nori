/**
 * Only same-site paths are honoured as a post-login destination. The check resolves the path the way a browser will:
 * browsers drop tabs and newlines and read a backslash as a slash, so "/\t/evil.com" passes a prefix test and still
 * lands on evil.com.
 */
export function safeNext(n?: string | null) {
  if (!n || !n.startsWith("/")) return "/dashboard";
  const here = "http://nori.invalid";
  let url: URL;
  try { url = new URL(n, here); } catch { return "/dashboard"; }
  return url.origin === here ? url.pathname + url.search + url.hash : "/dashboard";
}
