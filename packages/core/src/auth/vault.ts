import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { atsAccounts, type AtsType } from "../db/schema.js";

function vaultKey(): Buffer {
  const raw = process.env.CREDENTIALS_KEY?.trim() || process.env.SESSION_SECRET?.trim() || "nori-dev-vault-key-do-not-use-in-prod";
  return createHash("sha256").update(raw).digest();
}

export function encryptVaultSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptVaultSecret(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Invalid encrypted secret format");
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

/** Generate a strong password that satisfies Workday, iCIMS, and Oracle complexity rules (upper, lower, digit, symbol, 16 chars). */
export function generateAtsPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*?";
  const all = upper + lower + digits + symbols;
  const bytes = randomBytes(16);
  const chars = [
    upper[bytes[0]! % upper.length]!,
    lower[bytes[1]! % lower.length]!,
    digits[bytes[2]! % digits.length]!,
    symbols[bytes[3]! % symbols.length]!,
  ];
  for (let i = 4; i < 16; i++) {
    chars.push(all[bytes[i]! % all.length]!);
  }
  return chars.join("");
}

export type AtsAccountCredentials = {
  id: string;
  atsType: AtsType;
  employerKey: string;
  email: string;
  password: string;
  created: boolean;
};

/**
 * Get or create per-employer ATS credentials (e.g. for Workday account creation after form approval).
 * Reuses the existing account when applying to a second role at the same employer.
 */
export async function getOrCreateAtsAccount(
  db: Db,
  userId: string,
  atsType: AtsType,
  employerKey: string,
  email: string,
): Promise<AtsAccountCredentials> {
  const normKey = employerKey.trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(atsAccounts)
    .where(and(eq(atsAccounts.userId, userId), eq(atsAccounts.atsType, atsType), eq(atsAccounts.employerKey, normKey)))
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      atsType: existing.atsType,
      employerKey: existing.employerKey,
      email: existing.email,
      password: decryptVaultSecret(existing.encryptedPassword),
      created: false,
    };
  }

  const password = generateAtsPassword();
  const encryptedPassword = encryptVaultSecret(password);
  const [row] = await db
    .insert(atsAccounts)
    .values({
      userId,
      atsType,
      employerKey: normKey,
      email: email.trim(),
      encryptedPassword,
    })
    .returning();

  return {
    id: row!.id,
    atsType: row!.atsType,
    employerKey: row!.employerKey,
    email: row!.email,
    password,
    created: true,
  };
}

export async function listAtsAccounts(
  db: Db,
  userId: string,
): Promise<{ id: string; atsType: AtsType; employerKey: string; email: string; password: string; updatedAt: Date }[]> {
  const rows = await db.select().from(atsAccounts).where(eq(atsAccounts.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    atsType: r.atsType,
    employerKey: r.employerKey,
    email: r.email,
    password: decryptVaultSecret(r.encryptedPassword),
    updatedAt: r.updatedAt,
  }));
}
