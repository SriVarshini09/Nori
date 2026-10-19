import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Load ./.env (if present) before anything reads process.env. Variables already set in the environment
 * (for example by cross-env in an npm script) win over the file. Import this module first.
 */
const file = path.resolve(process.env.ENV_FILE ?? ".env");
if (existsSync(file)) {
  try { process.loadEnvFile(file); } catch (e) { console.warn(`[env] could not read ${file}: ${(e as Error).message}`); }
}
