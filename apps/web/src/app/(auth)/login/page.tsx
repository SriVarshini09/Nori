import type { Metadata } from "next";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { redirectIfSignedIn } from "@/components/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const to = Array.isArray(next) ? next[0] : next;
  await redirectIfSignedIn(to);
  return <AuthPanel mode="login" next={to} />;
}
