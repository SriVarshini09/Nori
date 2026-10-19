import { getDb } from "./client.js";
await getDb();
console.log("migrations applied", process.env.DATABASE_URL ? "(postgres)" : "(pglite ./data/pglite)");
