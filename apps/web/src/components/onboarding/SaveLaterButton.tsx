"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SaveLaterButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function saveLater() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/onboarding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "done", data: {} }),
      });
    } catch {
      /* proceed to dashboard */
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={saveLater}
      disabled={busy}
      className="cursor-pointer text-meta font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
    >
      {busy ? "Saving..." : "Save and finish later"}
    </button>
  );
}
