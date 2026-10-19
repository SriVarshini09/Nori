"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "./ui";

export function ExportGraphButton() {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await api.exportGraph(); } finally { setTimeout(() => setBusy(false), 600); }
  }
  return <Button variant="secondary" icon={Download} onClick={go} disabled={busy}>{busy ? "Exporting..." : "Export graph"}</Button>;
}
