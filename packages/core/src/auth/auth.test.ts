import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openTestDb } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { createSession, getSessionUser, hashPassword, revokeSession, sha256, verifyPassword } from "./index.js";

describe("passwords", () => {
  it("hashes with scrypt and a random salt, verifies in constant time", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(h.split("$")[4], "base64")).toHaveLength(16);
    expect(await hashPassword("correct horse")).not.toBe(h);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong horse", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("sha256 is hex", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("sessions", () => {
  it("creates, resolves, expires and revokes", async () => {
    const db = await openTestDb();
    const [u] = await db.insert(users).values({ email: "s@example.com" }).returning();
    const token = await createSession(db, u.id, "vitest");
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toBe(token);
    expect(row.userAgent).toBe("vitest");
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await getSessionUser(db, token))?.id).toBe(u.id);
    expect(await getSessionUser(db, "nope")).toBeNull();
    expect(await getSessionUser(db, undefined)).toBeNull();

    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, row.id));
    expect(await getSessionUser(db, token)).toBeNull();

    const t2 = await createSession(db, u.id, null);
    expect((await getSessionUser(db, t2))?.email).toBe("s@example.com");
    await revokeSession(db, t2);
    expect(await getSessionUser(db, t2)).toBeNull();
  });
});
