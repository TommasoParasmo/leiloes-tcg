import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
