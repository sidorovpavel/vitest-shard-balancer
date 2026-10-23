import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/fixture/**"],
    testTimeout: 60_000,
    restoreMocks: true,
  },
});
