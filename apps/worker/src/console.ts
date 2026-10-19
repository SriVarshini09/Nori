import readline from "node:readline";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "@jobgraph/core";

export const CONSOLE_ADDRESS = "local";

/**
 * stdin/stdout channel so the agent can be driven from a terminal with no tokens (CHANNEL_CONSOLE=1).
 * Every line typed is one inbound message; replies and pushed notifications print with an "agent>" prefix.
 */
export class ConsoleChannel implements ChannelAdapter {
  kind = "console" as const;
  available: boolean;
  private rl: readline.Interface | null = null;

  constructor(opts: { enabled?: boolean; input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {}) {
    this.available = opts.enabled ?? process.env.CHANNEL_CONSOLE === "1";
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stdout;
  }
  private input: NodeJS.ReadableStream;
  private output: NodeJS.WritableStream;

  async send(_address: string, msg: OutboundMessage): Promise<void> {
    const body = msg.text.split("\n").map((l, i) => (i === 0 ? `agent> ${l}` : `       ${l}`)).join("\n");
    const files = msg.attachments?.length ? `\n       [attached: ${msg.attachments.map((a) => a.path).join(", ")}]` : "";
    this.output.write(`\n${body}${files}\n`);
    this.rl?.prompt(true);
  }

  async listen(handler: (msg: InboundMessage) => Promise<void>): Promise<() => void> {
    const rl = readline.createInterface({ input: this.input, output: this.output, prompt: "you> ", terminal: Boolean((this.input as { isTTY?: boolean }).isTTY) });
    this.rl = rl;
    rl.prompt();
    let queue = Promise.resolve();
    rl.on("line", (line) => {
      const text = line.trim();
      if (!text) { rl.prompt(); return; }
      queue = queue.then(() => handler({ channel: "console", address: CONSOLE_ADDRESS, text }))
        .catch((e) => this.output.write(`agent> error: ${(e as Error).message}\n`))
        .then(() => rl.prompt());
    });
    return () => { rl.close(); this.rl = null; };
  }
}
