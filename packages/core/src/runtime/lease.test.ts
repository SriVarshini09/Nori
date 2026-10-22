import { describe, expect, it } from "vitest";
import { openTestDb } from "../db/client.js";
import { acquireLease, getState, releaseLease, setState, withLease } from "./lease.js";

describe("leases", () => {
  it("only one owner holds a lease; it can be renewed, released, and taken over after it expires", async () => {
    const db = await openTestDb();
    expect(await acquireLease(db, "job:agent", 60_000, "api")).toBe(true);
    expect(await acquireLease(db, "job:agent", 60_000, "worker")).toBe(false);
    expect(await acquireLease(db, "job:agent", 60_000, "api")).toBe(true); // renewal
    await releaseLease(db, "job:agent", "worker"); // not the owner: no effect
    expect(await acquireLease(db, "job:agent", 60_000, "worker")).toBe(false);
    await releaseLease(db, "job:agent", "api");
    expect(await acquireLease(db, "job:agent", 1, "worker")).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(await acquireLease(db, "job:agent", 60_000, "api")).toBe(true); // expired: taken over
  });

  it("withLease runs the job in one process only", async () => {
    const db = await openTestDb();
    let runs = 0;
    const job = () => withLease(db, "job:feeds", 60_000, async () => { runs++; await new Promise((r) => setTimeout(r, 30)); }, "a");
    const other = () => withLease(db, "job:feeds", 60_000, async () => { runs++; }, "b");
    const [a, b] = await Promise.all([job(), other()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(runs).toBe(1);
  });

  it("keeps small values across restarts", async () => {
    const db = await openTestDb();
    expect(await getState(db, "telegram:offset")).toBeUndefined();
    await setState(db, "telegram:offset", 42);
    await setState(db, "telegram:offset", 43);
    expect(await getState<number>(db, "telegram:offset")).toBe(43);
  });
});
