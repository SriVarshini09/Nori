import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["packages/**/*.test.ts", "apps/**/*.test.ts"], testTimeout: 60000,
    // Setup hooks open an in-memory database each; with every file starting at once on a busy machine (or CI runner)
    // that can pass the 10 s default even though it takes under 2 s alone. Same ceiling as the tests themselves.
    hookTimeout: 60000 },
  resolve: {
    alias: {
      "@jobgraph/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@jobgraph/drivers": path.resolve(__dirname, "packages/drivers/src/index.ts"),
      "@jobgraph/channels": path.resolve(__dirname, "packages/channels/src/index.ts"),
    },
  },
});
