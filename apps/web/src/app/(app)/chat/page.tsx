import type { Metadata } from "next";
import Link from "next/link";
import { AgentChat } from "@/components/agent/AgentChat";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Chat"
        subtitle={<>Talk to Nori in words. Connect Telegram, WhatsApp or Slack in <Link href="/settings#channels" className="font-medium text-accent underline-offset-4 hover:underline">Settings</Link> to do the same from your phone.</>}
      />
      <AgentChat variant="page" />
    </div>
  );
}
