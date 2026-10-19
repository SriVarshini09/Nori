import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["packages/**/*.test.ts", "apps/**/*.test.ts"], testTimeout: 60000 },
  resolve: {
    alias: {
      "@jobgraph/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@jobgraph/drivers": path.resolve(__dirname, "packages/drivers/src/index.ts"),
      "@jobgraph/channels": path.resolve(__dirname, "packages/channels/src/index.ts"),
    },
  },
});
