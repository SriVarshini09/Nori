/**
 * `npm run serve`: the offline stack (in-memory database, fake form driver, production web build) with a seeded demo
 * user, kept running so you can click through the real app. Ports 3200 (web) and 4200 (API); nothing persists.
 */
import { WEB, seedUser, startStack } from "./stack.mjs";

const stack = await startStack();
const seed = await seedUser(stack);
console.log(`\nNori is running (demo data, nothing is saved when you stop it).\n\n  Open:      ${WEB}/\n  Sign in:   ${seed.email}  /  ${seed.password}\n  Sign up:   ${WEB}/signup  (a fresh account walks through onboarding)\n\nPress Ctrl+C to stop.\n`);
const stop = async () => { await stack.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
