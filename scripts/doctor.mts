/**
 * `npm run doctor`: reads .env the way the API does and prints what is configured, what is blocked and on which key.
 * Nothing here calls a third-party service, so "configured" means the key is present, never that it was verified.
 */
import "../apps/worker/src/env.js";
import { checkEnv, integrationReport } from "../apps/api/src/env-check.js";

const check = checkEnv();
const rows = integrationReport();
const pad = (s: string, n: number) => s.padEnd(n);

console.log(`\nEnvironment: ${process.env.NODE_ENV ?? "development"}\n`);
for (const r of rows) {
  console.log(`${r.state === "configured" ? "configured" : "BLOCKED   "}  ${pad(r.name, 46)} ${r.needs.length ? `needs ${r.needs.join(", ")}` : ""}`);
  if (r.state === "blocked") console.log(`            without it: ${r.without}`);
}
console.log("");
for (const e of check.errors) console.log(`ERROR    ${e}`);
for (const w of check.warnings) console.log(`warning  ${w}`);
if (!check.errors.length && !check.warnings.length) console.log("No configuration problems found.");
console.log("\n\"configured\" means the key is present. Run the app against the service to find out whether it works.\n");
process.exit(check.errors.length ? 1 : 0);
