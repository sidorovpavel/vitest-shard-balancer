export type Timings = Readonly<Record<string, number>>;

/**
 * Splits `keys` into `count` groups of roughly equal total duration: heaviest first, each to the
 * group with the least so far (longest-processing-time first). A key with no timing weighs the
 * median of the keys that have one. Returns `undefined` when none of the keys has a timing, so the
 * caller can fall back to its own split.
 */
export function partition(
  keys: readonly string[],
  timings: Timings,
  count: number,
): string[][] | undefined {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  const known = keys
    .map((key) => timings[key])
    .filter((ms): ms is number => ms !== undefined)
    .sort((a, b) => a - b);
  if (known.length === 0) return undefined;
  const typical = known[Math.floor(known.length / 2)] ?? 0;

  const weighed = [...new Set(keys)]
    .map((key) => ({ key, ms: timings[key] ?? typical }))
    .sort((a, b) => b.ms - a.ms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const groups: string[][] = Array.from({ length: count }, () => []);
  const load: number[] = Array.from({ length: count }, () => 0);
  for (const { key, ms } of weighed) {
    let lightest = 0;
    for (let i = 1; i < count; i++) {
      const diff = (load[i] ?? 0) - (load[lightest] ?? 0);
      if (diff < 0 || (diff === 0 && (groups[i]?.length ?? 0) < (groups[lightest]?.length ?? 0))) {
        lightest = i;
      }
    }
    groups[lightest]?.push(key);
    load[lightest] = (load[lightest] ?? 0) + ms;
  }
  return groups;
}
