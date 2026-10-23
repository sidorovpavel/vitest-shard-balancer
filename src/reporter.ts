import path from "node:path";
import type { Reporter, TestModule, Vitest } from "vitest/node";
import {
  assertSmoothing,
  DEFAULT_TIMINGS_FILE,
  fileKey,
  readTimings,
  smoothTimings,
  writeTimings,
} from "./timings.js";

export interface TimingsReporterOptions {
  /** Timings file, relative to the Vitest root. Defaults to `.vitest-timings.json`. */
  timingsFile?: string | undefined;
  /**
   * Share of the new measurement when blending it into the previous one, in (0, 1]. Defaults to
   * `0.5`; `1` keeps only the latest run.
   */
  smoothing?: number | undefined;
  /**
   * Fail the merge when a test file Vitest finds is missing from the merged reports — a shard that
   * never uploaded, or two shards that split differently. Defaults to `true`.
   */
  requireAllFiles?: boolean | undefined;
}

/**
 * Records per-file durations on a `--merge-reports` run, the one run that sees every shard, and
 * does nothing on any other. A file's duration is everything it costs a worker: environment,
 * setup, import and tests.
 */
export class TimingsReporter implements Reporter {
  private vitest: Vitest | undefined;
  private readonly timingsFile: string;
  private readonly smoothing: number;
  private readonly requireAllFiles: boolean;

  constructor(options: TimingsReporterOptions = {}) {
    this.timingsFile = options.timingsFile ?? DEFAULT_TIMINGS_FILE;
    this.smoothing = options.smoothing ?? 0.5;
    this.requireAllFiles = options.requireAllFiles ?? true;
    assertSmoothing(this.smoothing);
  }

  onInit(vitest: Vitest): void {
    this.vitest = vitest;
  }

  async onTestRunEnd(testModules: ReadonlyArray<TestModule>): Promise<void> {
    const vitest = this.vitest;
    if (!vitest?.config.mergeReports) return;
    const { root } = vitest.config;

    const measured: Record<string, number> = {};
    for (const module of testModules) {
      const d = module.diagnostic();
      measured[fileKey(root, module.moduleId, module.project.name)] =
        d.environmentSetupDuration +
        d.prepareDuration +
        d.setupDuration +
        d.collectDuration +
        d.duration;
    }

    const expected = await this.expectedFiles(vitest);
    if (this.requireAllFiles) {
      const missing = [...expected].filter((key) => !(key in measured)).sort();
      if (missing.length > 0) {
        vitest.logger.error(
          `[vitest-shard-balancer] ${missing.length} test file(s) are not in the merged reports, so no shard ran them:\n${missing.map((key) => `  ${key}`).join("\n")}\n` +
            "Check that every shard's report reached the merge and that all shards read the same timings file. " +
            "If the shards ran with file filters or --project on purpose, the merge cannot apply them: set requireAllFiles: false.",
        );
        process.exitCode = 1;
        return;
      }
    }

    const file = path.resolve(root, this.timingsFile);
    writeTimings(file, smoothTimings(readTimings(file), measured, this.smoothing, expected));
  }

  /** Every test file the config finds, across all projects and ignoring CLI filters. */
  private async expectedFiles(vitest: Vitest): Promise<Set<string>> {
    const specifications = await vitest.globTestSpecifications();
    return new Set(
      specifications.map((spec) => fileKey(vitest.config.root, spec.moduleId, spec.project.name)),
    );
  }
}
