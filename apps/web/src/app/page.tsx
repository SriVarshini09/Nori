import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { LANDING_URL } from "@/lib/site";

/**
 * `/` has no page of its own: the landing page is the separate marketing site. Signed-in visitors go to Today,
 * everyone else to the landing site. Only a session the API still accepts counts, so a stale cookie cannot trap anyone.
 */
export default async function Root() {
  if ((await cookies()).get("jg_session")?.value) {
    const signedIn = await api.session().then(() => true, () => false);
    if (signedIn) redirect("/dashboard");
  }
  redirect(LANDING_URL);
}
