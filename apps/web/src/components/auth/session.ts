import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { safeNext } from "./next";

/**
 * Sign in and sign up are for signed-out visitors: someone the API still accepts goes straight on (to `next`, or
 * Today). A stale cookie must not lock anyone out of the forms, so only a session the API confirms counts.
 */
export async function redirectIfSignedIn(next?: string) {
  if (!(await cookies()).get("jg_session")?.value) return;
  const signedIn = await api.session().then(() => true, () => false);
  if (signedIn) redirect(safeNext(next));
}
