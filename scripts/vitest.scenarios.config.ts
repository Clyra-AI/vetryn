import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["examples/openrouter-typescript/test/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
