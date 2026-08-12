import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@vetryn/core": path.resolve(import.meta.dirname, "packages/core/src/index.ts"),
      "@vetryn/openrouter": path.resolve(import.meta.dirname, "packages/openrouter/src/index.ts"),
      "@vetryn/typescript": path.resolve(import.meta.dirname, "packages/typescript/src/index.ts"),
    },
  },
  test: {
    coverage: {
      exclude: ["**/dist/**", "**/*.config.*", "**/test/**"],
      include: ["packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "lcov"],
    },
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
