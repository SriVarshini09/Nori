import type { ApplyDriver } from "@jobgraph/core";
import { GreenhouseDriver } from "./greenhouse.js";
import { WebDriver } from "./web.js";

export * from "./generic.js";
export { GreenhouseDriver } from "./greenhouse.js";
export { WebDriver } from "./web.js";
export { submitAllowed, runApplyFlow } from "./flow.js";

/** Most specific first; WebDriver is the catch-all for any http(s) URL. */
export const DRIVERS: ApplyDriver[] = [new GreenhouseDriver(), new WebDriver()];

export function pickDriver(url: string): ApplyDriver | null {
  return DRIVERS.find((d) => d.supports(url)) ?? null;
}
