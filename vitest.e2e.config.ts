import { defineConfig } from "vitest/config";
import path from "node:path";

/** Browser end-to-end tests: `npm run e2e`. They start the full offline stack (see scripts/stack.mts). */
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 120_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    pool: "forks",
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "@jobgraph/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@jobgraph/drivers": path.resolve(__dirname, "packages/drivers/src/index.ts"),
      "@jobgraph/channels": path.resolve(__dirname, "packages/channels/src/index.ts"),
    },
  },
});
