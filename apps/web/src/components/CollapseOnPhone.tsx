"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * A panel that starts folded on a phone, so the page's main content is not pushed off screen, and open on a
 * laptop where there is room. The summary row only shows on small screens; people can still fold or unfold by hand.
 */
export function CollapseOnPhone({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches && ref.current) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} className="group">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-body-sm font-medium text-ink lg:hidden">
        {title}
        <Icon icon={ChevronDown} className="transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="mt-3 lg:mt-0">{children}</div>
    </details>
  );
}
