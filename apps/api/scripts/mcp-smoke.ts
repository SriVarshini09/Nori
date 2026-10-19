/** Smoke test: connect an MCP client to a running API over streamable HTTP and list tools. Usage: npx tsx apps/api/scripts/mcp-smoke.ts [url] */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? `http://localhost:${process.env.API_PORT ?? 4000}/mcp`;
const client = new Client({ name: "jobgraph-smoke", version: "0.0.1" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const { tools } = await client.listTools();
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
const status = await client.callTool({ name: "status", arguments: {} });
console.log("status ->", JSON.stringify(status.content).slice(0, 200));
await client.close();
