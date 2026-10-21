"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight, Briefcase, Building2, Ellipsis, FileText, Inbox, LayoutDashboard, Network, Send, Settings, SquareKanban, UserRound, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { NoriLogo } from "./Logo";
import { Square } from "./IndexLabel";
import { LogoutButton } from "./LogoutButton";

export type ShellData = {
  applicationsCount: number;
  needsYouCount: number;
  unreadCount: number;
  appliedThisWeek: number;
  repliedThisWeek: number;
  interviewsThisWeek: number;
  hoursSaved: number;
  userName: string;
  mock: boolean;
};

type NavItem = { href: string; label: string; icon: LucideIcon; count?: (d: ShellData) => number };

const NAV: NavItem[][] = [
  [
    { href: "/agent", label: "Auto apply", icon: Zap },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/jobs", label: "Jobs", icon: Briefcase },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/applications", label: "Applications", icon: Send, count: (d) => d.applicationsCount },
    { href: "/inbox", label: "Inbox", icon: Inbox, count: (d) => d.unreadCount },
    { href: "/tracker", label: "Tracker", icon: SquareKanban },
  ],
  [
    { href: "/graph", label: "Career graph", icon: Network },
    { href: "/resume", label: "Resume", icon: FileText },
    { href: "/profile", label: "Profile", icon: UserRound },
    { href: "/settings", label: "Settings", icon: Settings },
  ],
];

/** Phone tab bar. Everything else lives behind "More". */
const TABS = ["/agent", "/jobs", "/applications", "/inbox"];

const TAB_ITEMS = TABS.map((h) => NAV.flat().find((n) => n.href === h)!);

const CRUMB: Record<string, string> = Object.fromEntries(NAV.flat().map((n) => [n.href.slice(1), n.label]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Readable label for a path segment: known pages by name, ids as "Details", an id's "resume" child as "Edit resume". */
const crumb = (p: string, prev: string | undefined) => (UUID.test(p) ? (prev === "resume" ? "Studio" : "Details") : p === "resume" && prev && UUID.test(prev) ? "Edit resume" : CRUMB[p] ?? decodeURIComponent(p));

function Wordmark() {
  return (
    <Link href="/dashboard" className="inline-flex items-center" aria-label="Nori home">
      <NoriLogo size={34} />
    </Link>
  );
}

function NavList({ data, onNavigate, exclude = [] }: { data: ShellData; onNavigate?: () => void; exclude?: string[] }) {
  const pathname = usePathname();
  const groups = NAV.map((g) => g.filter((i) => !exclude.includes(i.href))).filter((g) => g.length > 0);
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map((group, gi) => (
        <ul key={gi} className={cx(gi > 0 && "border-t border-black/5 pt-5")}>
          {group.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = item.count?.(data) ?? 0;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group relative my-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-all duration-150",
                    active ? "bg-white text-ink shadow-[0_1px_2px_rgba(20,19,17,0.06),0_8px_18px_-10px_rgba(20,19,17,0.25)]" : "text-muted hover:bg-white/60 hover:text-ink",
                  )}
                >
                  <Icon icon={item.icon} size={17} className={active ? "text-emerald-700" : "text-ink-2 group-hover:text-ink"} />
                  <span className="flex-1">{item.label}</span>
                  {count > 0 && (
                    <span className={cx("min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tnum", active ? "bg-emerald-100 text-emerald-800" : "bg-stone text-ink-2")}>{count}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </nav>
  );
}

function SearchBox({ onDone }: { onDone?: () => void }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/jobs?q=${encodeURIComponent(term)}` : "/jobs");
    onDone?.();
  }
  return (
    <form onSubmit={onSearch} role="search" className="group">
      <label className="block">
        <span className="text-label font-medium uppercase text-faint">Search</span>
        <span className="mt-1.5 flex items-center border-b border-line transition-colors duration-150 focus-within:border-ink">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jobs, companies"
            aria-label="Search jobs"
            className="h-8 w-full bg-transparent text-meta text-ink placeholder:text-faint focus:outline-none"
          />
          <button type="submit" aria-label="Search" className="pl-2 text-muted hover:text-ink"><Icon icon={ArrowRight} /></button>
        </span>
      </label>
    </form>
  );
}

function Crumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-meta">
        <li className="text-faint">Nori</li>
        {parts.map((p, i) => {
          const href = "/" + parts.slice(0, i + 1).join("/");
          const last = i === parts.length - 1;
          return (
            <li key={href} className="flex min-w-0 items-center gap-2">
              <span className="text-line-strong" aria-hidden="true">/</span>
              {last ? (
                <span className="truncate font-medium text-ink" aria-current="page">{crumb(p, parts[i - 1])}</span>
              ) : (
                <Link href={href} className="truncate text-muted hover:text-ink">{crumb(p, parts[i - 1])}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StatsStrip({ data, className }: { data: ShellData; className?: string }) {
  return (
    <div className={cx("flex items-center gap-x-2 whitespace-nowrap text-meta text-muted tnum", className)}>
      <Link href="/tracker" className="transition-colors duration-150 hover:text-ink" title={`About ${data.hoursSaved}h saved vs applying by hand`}>
        <span className="text-ink">{data.appliedThisWeek}</span> applied<span className="hidden sm:inline"> this week</span>
        <span className="mx-2 text-line-strong">&middot;</span>
        <span className="text-ink">{data.repliedThisWeek}</span> replied
        <span className="mx-2 text-line-strong">&middot;</span>
        <span className="text-ink">{data.interviewsThisWeek}</span> interview{data.interviewsThisWeek === 1 ? "" : "s"}
      </Link>
      {data.needsYouCount > 0 && (
        <Link href="/applications" className="ml-1 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-[12px] font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-200 sm:ml-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          {data.needsYouCount} need you
        </Link>
      )}
    </div>
  );
}

export function Shell({ data, children }: { data: ShellData; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const moreActive = !TABS.some((h) => pathname === h || pathname.startsWith(`${h}/`));
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const footer = (
    <div className="space-y-2 text-[12px] text-muted">
      {data.mock && (
        <div className="flex items-center gap-2 text-label font-medium uppercase text-muted">
          <Square tone="hollow" size={6} /> Mock data
        </div>
      )}
      <div className="truncate text-ink-2">{data.userName}</div>
      <LogoutButton />
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[var(--shell-w)_minmax(0,1fr)]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-10 border-r border-black/5 px-4 py-5 lg:flex">
        <div className="flex h-7 items-center"><Wordmark /></div>
        <NavList data={data} />
        <SearchBox />
        <div className="mt-auto">{footer}</div>
      </aside>

      {/* phone: wordmark + stats on top, tab bar at the bottom, "More" opens the rest of the nav */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Wordmark />
          {data.mock && <span className="flex items-center gap-2 text-label font-medium uppercase text-muted"><Square tone="hollow" size={6} /> Mock</span>}
        </div>
        <div className="overflow-x-auto border-t border-line px-4 py-2">
          <StatsStrip data={data} />
        </div>
      </header>
      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-14 z-40 flex flex-col gap-8 overflow-y-auto border-t border-line bg-canvas px-8 py-6 lg:hidden">
          <NavList key={pathname} data={data} exclude={TABS} onNavigate={() => setOpen(false)} />
          <SearchBox onDone={() => setOpen(false)} />
          <div className="mt-auto">{footer}</div>
        </div>
      )}
      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid h-14 grid-cols-5">
          {TAB_ITEMS.map((t) => {
            const active = !open && (pathname === t.href || pathname.startsWith(`${t.href}/`));
            const count = t.count?.(data) ?? 0;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cx("relative flex h-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors duration-150", active ? "text-ink" : "text-muted")}
                >
                  <span aria-hidden="true" className={cx("absolute left-1/2 top-0 h-[2px] w-6 -translate-x-1/2 bg-accent transition-opacity duration-150", active ? "opacity-100" : "opacity-0")} />
                  <span className="relative">
                    <Icon icon={t.icon} size={20} />
                    {count > 0 && <span className="absolute -right-2 -top-1.5 text-[9px] font-medium leading-none text-ink tnum">{count}</span>}
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              className={cx("relative flex h-full w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors duration-150", open || moreActive ? "text-ink" : "text-muted")}
            >
              <span aria-hidden="true" className={cx("absolute left-1/2 top-0 h-[2px] w-6 -translate-x-1/2 bg-accent transition-opacity duration-150", open || moreActive ? "opacity-100" : "opacity-0")} />
              <Icon icon={open ? X : Ellipsis} size={20} />
              <span className="text-[10.5px]">More</span>
            </button>
          </li>
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-30 hidden h-14 items-center justify-between gap-6 border-b border-black/5 bg-canvas/80 px-10 backdrop-blur-md lg:flex">
          <Crumbs />
          <StatsStrip data={data} />
        </div>
        <main className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 pb-28 pt-8 sm:px-8 lg:px-10 lg:pb-24 lg:pt-14">{children}</main>
      </div>
    </div>
  );
}
