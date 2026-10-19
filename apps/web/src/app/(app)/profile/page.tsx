import type { Metadata } from "next";
import { api } from "@/lib/api";
import { ProfileForm } from "@/components/ProfileForm";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { profile } = await api.me();
  return (
    <div>
      <PageHeader
        label="Profile"
        title={<>Who you are,<br />what you want.</>}
      />
      <ProfileForm profile={profile} />
    </div>
  );
}
