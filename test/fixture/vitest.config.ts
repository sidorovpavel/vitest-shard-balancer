import { defineConfig } from "vitest/config";
import { createSequencer, TimingsReporter } from "../../src/index.js";

const timingsFile = process.env.TIMINGS_FILE ?? ".vitest-timings.json";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    sequence: { sequencer: createSequencer({ timingsFile }) },
    reporters: [
      "default",
      new TimingsReporter({
        timingsFile,
        smoothing: 1,
        requireAllFiles: process.env.REQUIRE_ALL_FILES !== "false",
      }),
    ],
  },
});
