import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["**/dist/**", "**/*.config.*", "**/test/**"],
      include: ["packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "lcov"],
    },
    include: ["packages/*/test/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
