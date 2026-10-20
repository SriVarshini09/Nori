import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

export type HttpStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 503;

export const bad = (message: string, status: HttpStatus = 400) => new HTTPException(status, { message });

/** Parse a JSON body against a schema; an empty body counts as {}. Errors become readable 400 responses. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text.trim()) {
    try { raw = JSON.parse(text); } catch { throw bad("Body must be JSON"); }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw bad(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

export const uuidOk = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
