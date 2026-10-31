import type { Metadata } from "next";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { redirectIfSignedIn } from "@/components/auth/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  await redirectIfSignedIn();
  return <AuthPanel mode="signup" />;
}
