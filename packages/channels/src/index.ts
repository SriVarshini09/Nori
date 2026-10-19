import type { ChannelAdapter } from "@jobgraph/core";
import { EmailChannel } from "./email.js";
import { SlackChannel } from "./slack.js";
import { TelegramChannel } from "./telegram.js";
import { WhatsAppChannel } from "./whatsapp.js";

export * from "./composio.js";
export * from "./telegram.js";
export * from "./slack.js";
export * from "./email.js";
export * from "./whatsapp.js";
export * from "./inbox.js";
export * from "./sheets.js";
export * from "./router.js";

/** One default instance per channel kind. Slack and email need COMPOSIO_USER_ID here; the router builds per-user instances. */
export const ALL_CHANNELS: ChannelAdapter[] = [new TelegramChannel(), new SlackChannel(), new EmailChannel(), new WhatsAppChannel()];
