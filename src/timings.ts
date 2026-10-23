import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Timings } from "./partition.js";

export const DEFAULT_TIMINGS_FILE = ".vitest-timings.json";

const PREFIX = "[vitest-shard-balancer]";

/**
 * Reads a timings file. A missing file is no timings; a file that does not parse, or is not an
 * object, is no timings plus a warning, and an entry that is not a finite non-negative number is
 * dropped. Never throws: a broken cache should cost a balanced split, not the run.
 */
export function readTimings(file: string): Timings {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.warn(`${PREFIX} Ignoring ${file}: not valid JSON.`);
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(`${PREFIX} Ignoring ${file}: not a JSON object.`);
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0,
    ),
  );
}

/**
 * Blends a new measurement into the previous one: `weight` is the share of the new figure, so `1`
 * keeps only the latest run and `0.5` halves the effect of a single noisy one. A previous key that
 * was not measured survives unchanged if it is in `existing` — a file this merge did not cover —
 * and drops out otherwise, which is how a deleted test file leaves the file. Without `existing`,
 * only the measured keys survive.
 */
export function smoothTimings(
  previous: Timings,
  measured: Timings,
  weight: number,
  existing: ReadonlySet<string> = new Set(),
): Timings {
  assertSmoothing(weight);
  const kept = Object.entries(previous).filter(([key]) => !(key in measured) && existing.has(key));
  const blended = Object.entries(measured).map(([key, ms]) => {
    const before = previous[key];
    return [key, Math.round(before === undefined ? ms : before + weight * (ms - before))] as const;
  });
  return Object.fromEntries([...kept, ...blended]);
}

export function assertSmoothing(weight: number): void {
  if (!(weight > 0 && weight <= 1)) {
    throw new RangeError(`smoothing must be in (0, 1], got ${weight}`);
  }
}

export function writeTimings(file: string, timings: Timings): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(timings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

export function fileKey(root: string, moduleId: string, projectName: string): string {
  const relative = path.relative(root, moduleId).split(path.sep).join("/");
  return projectName ? `${projectName}:${relative}` : relative;
}
