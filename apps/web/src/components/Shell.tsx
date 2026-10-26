"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Briefcase, Ellipsis, FileText, Inbox, MessageCircle, Network, Send, Settings, SlidersHorizontal, Sun, UserRound, X,
  type LucideIcon,
} from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { NoriLogo } from "./Logo";
import { LogoutButton } from "./LogoutButton";
import { DryRunBand } from "./DryRunBand";
import { NoriMascot3D } from "./mascot/NoriMascot3D";

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
  /** False: this server never sends; forms are filled and stop. Shown as a band on every page. */
  liveSubmit: boolean;
};

type NavItem = { href: string; label: string; icon: LucideIcon; iconTone: string; count?: (d: ShellData) => number; attn?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard", label: "Today", icon: Sun, iconTone: "bg-[#fff1dc] text-[#964208]", count: (d) => d.needsYouCount, attn: true },
      { href: "/applications", label: "Applications", icon: Send, iconTone: "bg-[#dff6ec] text-[#07523b]" },
      { href: "/jobs", label: "Jobs", icon: Briefcase, iconTone: "bg-[#e5f1ff] text-[#15437a]" },
    ],
  },
  {
    label: "Rules and evidence",
    items: [
      { href: "/agent", label: "Lanes and autopilot", icon: SlidersHorizontal, iconTone: "bg-[#efe9ff] text-[#432b70]" },
      { href: "/graph", label: "Career graph", icon: Network, iconTone: "bg-[#e2f7f5] text-[#0b5254]" },
      { href: "/resume", label: "Resumes", icon: FileText, iconTone: "bg-[#ffe9ee] text-[#7a1b34]" },
    ],
  },
  {
    label: "Talk",
    items: [
      { href: "/inbox", label: "Inbox", icon: Inbox, iconTone: "bg-[#fff1dc] text-[#7a3106]", count: (d) => d.unreadCount },
      { href: "/chat", label: "Chat", icon: MessageCircle, iconTone: "bg-[#dff6ec] text-[#07523b]" },
    ],
  },
];

const FOOT: NavItem[] = [
  { href: "/profile", label: "Profile", icon: UserRound, iconTone: "bg-[#e5f1ff] text-[#15437a]" },
  { href: "/settings", label: "Settings", icon: Settings, iconTone: "bg-sunken text-ink-2" },
];

/** Phone tab bar. Everything else lives behind "More". */
const TABS: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: Sun, iconTone: "bg-[#fff1dc] text-[#964208]", count: (d) => d.needsYouCount, attn: true },
  { href: "/applications", label: "Applications", icon: Send, iconTone: "bg-[#dff6ec] text-[#07523b]" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, iconTone: "bg-[#e5f1ff] text-[#15437a]" },
  { href: "/chat", label: "Chat", icon: MessageCircle, iconTone: "bg-[#dff6ec] text-[#07523b]" },
];
const MORE: NavItem[] = [...NAV.flatMap((g) => g.items).filter((i) => !TABS.some((t) => t.href === i.href)), ...FOOT];

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Count({ n, attn }: { n: number; attn?: boolean }) {
  if (n <= 0) return null;
  return (
    <span className={cx("min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tnum", attn ? "bg-attn-tint text-attn-fg ring-1 ring-inset ring-attn" : "bg-sunken text-ink-2")}>
      {n}
      <span className="sr-only">{attn ? " waiting on you" : " new"}</span>
    </span>
  );
}

function RailLink({ item, data, pathname, onNavigate }: { item: NavItem; data: ShellData; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative flex min-h-10 items-center gap-2.5 rounded-control px-2.5 text-[13.5px] transition-all duration-150",
          active
            ? "border border-[#bce6d1] bg-[#e6f8ef] font-semibold text-accent-fg shadow-2xs"
            : "font-medium text-ink-2 hover:bg-surface/85 hover:text-ink",
        )}
      >
        <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", active ? "bg-accent text-white shadow-2xs" : item.iconTone)}>
          <Icon icon={item.icon} size={15} />
        </span>
        <span className="flex-1">{item.label}</span>
        <Count n={item.count?.(data) ?? 0} attn={item.attn} />
      </Link>
    </li>
  );
}

function Rail({ data, pathname }: { data: ShellData; pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-[var(--rail-w)] shrink-0 flex-col border-r border-line/85 bg-surface/75 px-3.5 py-5 backdrop-blur-md lg:flex">
      <div className="mb-6 flex items-center justify-between px-2.5">
        <Link href="/dashboard" aria-label="Nori, Today" className="inline-flex"><NoriLogo size={28} /></Link>
        <span className="rounded-full border border-[#bce6d1] bg-[#e6f8ef] px-2.5 py-0.5 text-[11px] font-semibold text-accent-fg">Agent</span>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-5">
        {NAV.map((g) => (
          <div key={g.label}>
            <p className="mb-1.5 px-3 text-[11.5px] font-semibold tracking-wide text-muted">{g.label}</p>
            <ul className="flex flex-col gap-0.5">{g.items.map((i) => <RailLink key={i.href} item={i} data={data} pathname={pathname} />)}</ul>
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3 pt-4">
        <NoriMascot3D variant="rail" className="bento-mint border-[#bce6d1] shadow-2xs" needsYouCount={data.needsYouCount} />
        <ul className="flex flex-col gap-0.5">{FOOT.map((i) => <RailLink key={i.href} item={i} data={data} pathname={pathname} />)}</ul>
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 pt-3">
          <span className="min-w-0 truncate text-meta font-medium text-ink-2">{data.userName}</span>
          <LogoutButton />
        </div>
        {data.mock && <p className="px-3 text-[12px] text-muted">Demo data, nothing is real.</p>}
      </div>
    </aside>
  );
}

export function Shell({ data, children }: { data: ShellData; children: ReactNode }) {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const moreActive = !TABS.some((t) => isActive(pathname, t.href));
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-on-ink">Skip to content</a>
      {!data.liveSubmit && <DryRunBand />}
      <div className="flex min-h-0 flex-1">
        <Rail data={data} pathname={pathname} />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* phone top bar */}
          <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur-xs lg:hidden">
            <Link href="/dashboard" aria-label="Nori, Today"><NoriLogo size={26} /></Link>
            {data.needsYouCount > 0 && (
              <Link href="/dashboard" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-attn-tint px-3 text-[12px] font-semibold text-attn-fg ring-1 ring-inset ring-attn">
                {data.needsYouCount} waiting on you
              </Link>
            )}
          </header>

          <main id="main" className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">{children}</main>
        </div>
      </div>

      {/* phone: More sheet */}
      {open && (
        <div id="more-sheet" className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] top-14 z-40 flex flex-col overflow-y-auto border-t border-line bg-surface px-4 py-4 lg:hidden">
          <div className="mb-3">
            <NoriMascot3D variant="rail" needsYouCount={data.needsYouCount} />
          </div>
          <ul className="flex flex-col gap-0.5">{MORE.map((i) => <RailLink key={i.href} item={i} data={data} pathname={pathname} onNavigate={() => setOpenOn(null)} />)}</ul>
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-3 pt-3">
            <span className="min-w-0 truncate text-meta text-ink-2">{data.userName}</span>
            <LogoutButton />
          </div>
        </div>
      )}

      {/* phone: tab bar */}
      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xs lg:hidden">
        <ul className="grid h-[3.75rem] grid-cols-5">
          {TABS.map((t) => {
            const active = !open && isActive(pathname, t.href);
            const count = t.count?.(data) ?? 0;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-ink" : "text-muted")}
                >
                  <span className="relative">
                    <Icon icon={t.icon} size={20} strokeWidth={active ? 2 : 1.5} className={active ? "text-accent" : ""} />
                    {count > 0 && (
                      <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-attn px-1 text-center text-[10px] font-semibold leading-4 text-on-ink tnum">{count}</span>
                    )}
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpenOn(open ? null : pathname)}
              aria-expanded={open}
              aria-controls="more-sheet"
              className={cx("flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium", open || moreActive ? "text-ink" : "text-muted")}
            >
              <Icon icon={open ? X : Ellipsis} size={20} />
              More
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
