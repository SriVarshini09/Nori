import type { ApplyDriver, DriverContext, DriverResult } from "@jobgraph/core";
import { runApplyFlow } from "./flow.js";

/** Best-effort generic driver for any http(s) application page. */
export class WebDriver implements ApplyDriver {
  readonly atsType = "web" as const;

  supports(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  run(ctx: DriverContext): Promise<DriverResult> {
    return runApplyFlow(ctx, { name: "web" });
  }
}
