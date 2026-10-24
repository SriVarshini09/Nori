"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Icon, cx } from "./ui";

type Choice = "system" | "light" | "dark";
const KEY = "nori-theme";
const EVENT = "nori-theme-change";

function read(): Choice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(EVENT, onChange); };
}

/** Light, dark, or follow the device. Kept in this browser only; the root layout applies it before first paint. */
export function ThemeChoice() {
  const choice = useSyncExternalStore(subscribe, read, () => "system" as Choice);

  function pick(c: Choice) {
    const root = document.documentElement;
    if (c === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", c);
    try {
      if (c === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch { /* storage blocked: the choice lasts for this visit */ }
    window.dispatchEvent(new Event(EVENT));
  }

  const options: { id: Choice; label: string; icon: typeof Sun }[] = [
    { id: "system", label: "Match my device", icon: Monitor },
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={choice === o.id}
          onClick={() => pick(o.id)}
          className={cx("flex h-12 items-center gap-2.5 rounded-control border px-4 text-body-sm font-medium", choice === o.id ? "border-ink bg-sunken text-ink" : "border-line bg-surface text-ink-2 hover:border-control")}
        >
          <Icon icon={o.icon} /> {o.label}
        </button>
      ))}
    </div>
  );
}
