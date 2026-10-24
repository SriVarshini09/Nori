import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "../db/client.js";
import { authTokens } from "../db/schema.js";
import { ensureDefaultUser } from "../users.js";
import { LINK_CODE_LENGTH, consumeChannelLinkCode, extractLinkCode, issueChannelLinkCode } from "./tokens.js";

let db: Db;
let userId: string;
beforeAll(async () => {
  db = await openTestDb();
  userId = (await ensureDefaultUser(db, "link@example.com")).id;
}, 60_000);

describe("chat link codes", () => {
  it("issues a short unambiguous code that spends once, and never stores it in clear", async () => {
    const { code, expiresAt } = await issueChannelLinkCode(db, userId);
    expect(code).toHaveLength(LINK_CODE_LENGTH);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    const rows = await db.select().from(authTokens);
    expect(rows.map((r) => r.tokenHash)).not.toContain(code);
    expect(await consumeChannelLinkCode(db, code.toLowerCase())).toBe(userId); // case-insensitive
    expect(await consumeChannelLinkCode(db, code)).toBeNull(); // spent
  });

  it("a new code retires the old one; junk is refused without a query", async () => {
    const a = await issueChannelLinkCode(db, userId);
    const b = await issueChannelLinkCode(db, userId);
    expect(await consumeChannelLinkCode(db, a.code)).toBeNull();
    expect(await consumeChannelLinkCode(db, b.code)).toBe(userId);
    expect(await consumeChannelLinkCode(db, "")).toBeNull();
    expect(await consumeChannelLinkCode(db, "TOO-LONG-CODE")).toBeNull();
  });

  it("reads a code sent alone or after /start, and nothing else", () => {
    expect(extractLinkCode("K7PX4M")).toBe("K7PX4M");
    expect(extractLinkCode("  k7px4m ")).toBe("K7PX4M");
    expect(extractLinkCode("/start K7PX4M")).toBe("K7PX4M");
    expect(extractLinkCode("/start@NoriNoteBot K7PX4M")).toBe("K7PX4M");
    expect(extractLinkCode("/start")).toBeNull();
    expect(extractLinkCode("apply 2")).toBeNull();
    // Six letters look like a code too. Only an unlinked chat is checked this way, and an unknown code just gets the instructions.
    expect(extractLinkCode("status")).toBe("STATUS");
  });
});
