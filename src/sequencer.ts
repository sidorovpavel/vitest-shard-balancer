import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import { partition } from "./partition.js";
import { DEFAULT_TIMINGS_FILE, fileKey, readTimings } from "./timings.js";

export interface SequencerOptions {
  /** Timings file, relative to the Vitest root. Defaults to `.vitest-timings.json`. */
  timingsFile?: string | undefined;
}

/**
 * A sequencer whose `shard()` splits by the durations in the timings file instead of by path hash.
 * With no timings for any of the files it falls back to Vitest's own split, so a first run behaves
 * exactly like plain `--shard`.
 */
export function createSequencer(options: SequencerOptions = {}): typeof BaseSequencer {
  const timingsFile = options.timingsFile ?? DEFAULT_TIMINGS_FILE;

  return class DurationSequencer extends BaseSequencer {
    override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
      const { root, shard } = this.ctx.config;
      if (!shard) return super.shard(files);

      const byKey = new Map<string, TestSpecification[]>();
      for (const spec of files) {
        const key = fileKey(root, spec.moduleId, spec.project.name);
        byKey.set(key, [...(byKey.get(key) ?? []), spec]);
      }
      const groups = partition(
        [...byKey.keys()],
        readTimings(path.resolve(root, timingsFile)),
        shard.count,
      );
      if (!groups) return super.shard(files);
      return (groups[shard.index - 1] ?? []).flatMap((key) => byKey.get(key) ?? []);
    }
  };
}

export const DurationSequencer = createSequencer();
