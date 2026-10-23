# vitest-shard-balancer

[![npm](https://img.shields.io/npm/v/vitest-shard-balancer)](https://www.npmjs.com/package/vitest-shard-balancer)
[![CI](https://github.com/sidorovpavel/vitest-shard-balancer/actions/workflows/ci.yml/badge.svg)](https://github.com/sidorovpavel/vitest-shard-balancer/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vitest-shard-balancer)](./LICENSE)

**Timing-based test splitting for Vitest.** Balance `vitest --shard` runs by how long each test
file actually takes, so parallel CI jobs finish at the same time — instead of Vitest's default
split by path hash.
- Drop-in: one sequencer and one reporter in `vitest.config.ts`, no CLI wrapper, no service.
- Learns from your own runs: durations are recorded on `vitest --merge-reports`.
- Fails loudly when a shard's report goes missing, instead of merging green over tests that never
  ran.
- Falls back to plain `--shard` when it knows nothing yet. Zero runtime dependencies.
- Works with Vitest 3.2, 4 and 5, coverage, and multi-project configs.

## Contents

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [GitHub Actions](#github-actions)
- [Other CI systems](#other-ci-systems)
- [Configuration](#configuration)
- [API](#api)
- [The timings file](#the-timings-file)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Alternatives](#alternatives)
- [Development](#development)

## Why

`vitest run --shard=2/3` sorts your test files by a hash of their path and gives each shard the
same **number** of files. That is fair when files cost about the same. Real suites are not like
that: a few integration or journey files often take ten times longer than a unit test, and which
shard they hash into is luck. The CI run lasts as long as its slowest shard, so the other shards
sit idle while you pay for them.

The same five files, three shards:

```text
Vitest's hash split                balanced by duration
shard 1  ████████████▌  673 ms     shard 1  ████████████   603 ms
shard 2  ███████▋       383 ms     shard 2  ██████████▏    509 ms
shard 3  █████▍         274 ms     shard 3  ████████▏      411 ms
```

Vitest's maintainers suggest a custom sequencer for this
([vitest#9184](https://github.com/vitest-dev/vitest/issues/9184)). This package is one, together
with the half people usually leave out: recording the durations and checking that the shards agree.

## Install

```sh
npm install --save-dev vitest-shard-balancer
# pnpm add -D vitest-shard-balancer
# yarn add -D vitest-shard-balancer
```

Requirements: Vitest `>=3.2` and Node.js `^22.12.0 || >=24`. The package is ESM-only, which is
what `vitest.config.ts` is anyway.

## Quick start

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { DurationSequencer, TimingsReporter } from "vitest-shard-balancer";

export default defineConfig({
  test: {
    sequence: { sequencer: DurationSequencer },
    reporters: ["default", new TimingsReporter()],
  },
});
```

Then, in CI:

```sh
# on each of N machines
vitest run --shard=1/3 --reporter=default --reporter=blob --outputFile.blob=.vitest-reports/blob-1.json

# once, after all shards, with every blob in .vitest-reports/
vitest run --merge-reports=.vitest-reports   # writes .vitest-timings.json
```

Carry `.vitest-timings.json` to the next run (the CI cache is the natural place — see
[GitHub Actions](#github-actions)) and the shards of that run are balanced.

Nothing changes locally: without `--shard` the sequencer does not split, and without
`--merge-reports` the reporter writes nothing.

## How it works

There are two halves, and they run at different times.

### 1. Recording — `TimingsReporter`

The reporter acts only on a `vitest --merge-reports` run, because that is the only run that sees
the results of every shard. For each test file it records the file's **whole cost to a worker**:

```text
environment setup + prepare + setup files + collect (import) + tests
```

Not just the tests. A file that imports half your app into `jsdom` costs most of its time before
its first test runs, and a shard pays for all of it.

The new figure is blended with the previous one, so a single slow run (a noisy neighbour, a cold
disk) does not reshuffle every shard:

```text
stored = previous + smoothing × (measured − previous)      smoothing defaults to 0.5
```

Files that no longer exist drop out of the file; new files enter with their measured value. A file
that still exists but was not in this merge keeps its stored value, so a merge that covers part of
the suite never erases the timings of the rest.

### 2. Splitting — `DurationSequencer`

When Vitest runs with `--shard=i/n`, the sequencer's `shard()` reads the timings file and assigns
files greedily — the **longest-processing-time first** rule:
1. Sort files by duration, longest first (ties broken by path, so every shard sorts identically).
2. Give each file to the shard with the smallest total so far (ties go to the shard with fewer
   files, then to the lower index).
3. Run the files that landed on shard `i`.

A worked example with three shards:

| File       | ms  | Goes to | Totals after (1 / 2 / 3) |
| ---------- | --- | ------- | ------------------------ |
| `heavy`    | 600 | 1       | 600 / 0 / 0              |
| `medium-a` | 300 | 2       | 600 / 300 / 0            |
| `medium-b` | 300 | 3       | 600 / 300 / 300          |
| `light-a`  | 200 | 2       | 600 / 500 / 300          |
| `light-b`  | 100 | 3       | 600 / 500 / 400          |

Greedy LPT is not optimal in theory, but it is guaranteed to stay within a third of the optimum
and is what timing-based splitters generally use.

Edge cases:
- **A file with no timing** (a new test file) weighs the **median** of the known files, so it
  neither crowds one shard nor gets ignored.
- **No timings at all** (the first run, a fresh cache) — the sequencer hands over to Vitest's own
  hash split. Your first run behaves exactly like plain `--shard`.
- **A broken timings file** (not JSON, not an object) is ignored with a warning, and an entry that
  is not a non-negative number is dropped. A bad cache costs you a balanced split, never the run.

### 3. The safety net

Every shard computes the whole split **on its own**, from its own copy of the timings file. If two
shards read different copies, they compute different splits: some file may run on two shards and
another on none. Vitest's merge does not notice — it merges whatever reports arrived, so a file
that never ran simply is not there, and the run is green.

So on the merge, the reporter compares the files in the merged reports with the files Vitest finds
for the config. If any is missing, it fails the run, lists them, and **does not write timings**:

```text
[vitest-shard-balancer] 1 test file(s) are not in the merged reports, so no shard ran them:
  tests/light-a.test.ts
```

The same check catches a shard whose blob never got uploaded. The merge compares against the
**whole** config: Vitest's `--merge-reports` does not apply file filters or `--project`, so if your
shards run a subset on purpose (`vitest run src/unit --shard=…`), turn the check off with
`requireAllFiles: false`. The files outside the subset keep their stored timings.

## GitHub Actions

A complete workflow. Three jobs:
- **plan** restores the latest timings from the Actions cache **once** and passes that one copy
  to every shard as an artifact. Restoring the cache in each shard instead would let a cache entry
  saved by another run between two restores give two shards different inputs.
- **test** runs the shards. Each writes a blob report.
- **merge** merges the blobs, which records new timings, and saves them to the cache.

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - name: Restore the latest timings
        uses: actions/cache/restore@v4
        with:
          path: .vitest-timings.json
          key: vitest-timings-${{ github.run_id }}
          restore-keys: vitest-timings-

      - name: Start from empty timings when there are none
        run: test -f .vitest-timings.json || echo '{}' > .vitest-timings.json

      - uses: actions/upload-artifact@v4
        with:
          name: vitest-timings
          path: .vitest-timings.json
          include-hidden-files: true
          retention-days: 1

  test:
    needs: plan
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci

      - uses: actions/download-artifact@v4
        with:
          name: vitest-timings

      - name: Test shard ${{ matrix.shard }}/3
        run: >-
          npx vitest run --shard=${{ matrix.shard }}/3
          --reporter=default --reporter=blob
          --outputFile.blob=.vitest-reports/blob-${{ matrix.shard }}.json

      - uses: actions/upload-artifact@v4
        with:
          name: vitest-blob-${{ matrix.shard }}
          path: .vitest-reports
          include-hidden-files: true
          if-no-files-found: error
          retention-days: 1

  merge:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci

      - uses: actions/download-artifact@v4
        with:
          pattern: vitest-blob-*
          path: .vitest-reports
          merge-multiple: true

      - uses: actions/download-artifact@v4
        with:
          name: vitest-timings

      - name: Merge reports and record timings
        run: npx vitest run --merge-reports=.vitest-reports

      - name: Save timings for the next run
        uses: actions/cache/save@v4
        with:
          path: .vitest-timings.json
          key: vitest-timings-${{ github.run_id }}-${{ github.run_attempt }}
```

Why it is written this way:
- **`--reporter=default` beside `--reporter=blob`.** A blob reporter prints nothing. Without the
  default reporter, a failing test is named in no log of the run.
- **No `--reporter` on the merge.** A `--reporter` flag on the command line _replaces_ the
  reporters in your config, `TimingsReporter` included, and then nothing is recorded. If you want
  another output on the merge, add it to `reporters` in the config instead.
- **The merge downloads the plan's timings first**, so the new figures are blended with the ones
  the shards actually used.
- **A unique cache key per run** (`run_id` + `run_attempt`). Actions cache entries are immutable,
  so a fixed key would be written once and never again. `restore-keys: vitest-timings-` picks the
  most recent entry.
- **Only green shards produce new timings**, because `merge` runs only when every shard passed.
  That is usually what you want. Add `if: always()` to `merge` to record timings from failing runs
  too: the failures still fail the merge.
- **Pull requests.** A pull request can read cache entries from its own branch and from its base
  branch, so its first run starts from the timings of `main`.
- **Pin actions to a commit SHA** in a real workflow. The tags above are for readability.

### With coverage

Run the shards with coverage on and the thresholds off — a third of the suite covers a third of
the code — and let the merge apply them to the whole:

```sh
vitest run --coverage --coverage.thresholds=false --shard=1/3 --reporter=default --reporter=blob --outputFile.blob=.vitest-reports/blob-1.json
vitest run --coverage --merge-reports=.vitest-reports
```

### More shards

Change the matrix and the `/3`. The sequencer needs nothing else: it reads the shard count from
`--shard`. Vitest itself refuses more shards than test files.

## Other CI systems

The recipe is the same everywhere:
1. Before the shards start, fetch **one** copy of `.vitest-timings.json` from wherever you keep it
   (CI cache, an artifact of the last successful run on the main branch, object storage) and give
   every shard that same copy.
2. On each machine: `vitest run --shard=$INDEX/$TOTAL --reporter=default --reporter=blob
   --outputFile.blob=.vitest-reports/blob-$INDEX.json`, and upload the blob.
3. After all shards: download every blob and the timings copy from step 1, run
   `vitest run --merge-reports=.vitest-reports`, and store the new `.vitest-timings.json` for next
   time.

GitLab's `parallel:` exposes the index and total as `CI_NODE_INDEX` and `CI_NODE_TOTAL`; CircleCI's
`parallelism` as `CIRCLE_NODE_INDEX` (zero-based — add one) and `CIRCLE_NODE_TOTAL`.

You can also **commit** the timings file instead of caching it. Every shard then reads the same
copy by construction. The cost is that the figures go stale until someone refreshes them, and a
refresh is a commit.

## Configuration

`DurationSequencer` and a plain `new TimingsReporter()` use the defaults. To change them:

```ts
import { defineConfig } from "vitest/config";
import { createSequencer, TimingsReporter } from "vitest-shard-balancer";

const timingsFile = "ci/vitest-timings.json";

export default defineConfig({
  test: {
    sequence: { sequencer: createSequencer({ timingsFile }) },
    reporters: [
      "default",
      new TimingsReporter({ timingsFile, smoothing: 0.3, requireAllFiles: true }),
    ],
  },
});
```

Give both halves the same `timingsFile`.

### `createSequencer(options)`

| Option        | Type     | Default                  | Description                                                                        |
| ------------- | -------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `timingsFile` | `string` | `".vitest-timings.json"` | Where to read timings, relative to the Vitest `root` (an absolute path works too). |

### `new TimingsReporter(options)`

| Option            | Type      | Default                  | Description                                                                                                                         |
| ----------------- | --------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `timingsFile`     | `string`  | `".vitest-timings.json"` | Where to write timings, relative to the Vitest `root`. Directories are created.                                                     |
| `smoothing`       | `number`  | `0.5`                    | Share of the new measurement, in `(0, 1]`. `1` keeps only the latest run; lower values react more slowly. Throws outside the range. |
| `requireAllFiles` | `boolean` | `true`                   | Fail the merge, and write nothing, when a test file is missing from the merged reports.                                             |

## API

Everything is a named export of `vitest-shard-balancer`, with TypeScript types included.

| Export                                                  | What it is                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DurationSequencer`                                     | The sequencer with default options. Pass it to `test.sequence.sequencer`.                  |
| `createSequencer(options?)`                             | Builds a sequencer class with options.                                                     |
| `TimingsReporter`                                       | The reporter class. Add an instance to `test.reporters`.                                   |
| `partition(keys, timings, count)`                       | The split itself: returns `count` arrays of keys, or `undefined` when no key has a timing. |
| `readTimings(file)`                                     | Reads and validates a timings file; never throws.                                          |
| `smoothTimings(previous, measured, weight, existing?)`  | The blending step the reporter uses; unmeasured keys in `existing` are kept unchanged.     |
| `DEFAULT_TIMINGS_FILE`                                  | `".vitest-timings.json"`.                                                                  |
| `Timings`, `SequencerOptions`, `TimingsReporterOptions` | Types.                                                                                     |

`partition` is pure and independent of Vitest, so you can use it to split anything by duration:

```ts
import { partition } from "vitest-shard-balancer";

partition(["a", "b", "c", "d"], { a: 900, b: 500, c: 100 }, 2);
// → [["a", "c"], ["b", "d"]]   "d" has no timing, so it weighs the median (500)
```

## The timings file

A flat JSON object from test file to milliseconds, sorted by key so it diffs cleanly:

```json
{
  "tests/journeys/onboarding.test.tsx": 4210,
  "tests/lib/format.test.ts": 180,
  "unit:tests/a.test.ts": 95
}
```

- Keys are paths relative to the Vitest `root`, always with `/`.
- In a config with `test.projects`, a key is prefixed by the project name — `unit:tests/a.test.ts`
  — because the same file can run in two projects with different environments and costs.
- Values are rounded milliseconds.

Add it to `.gitignore` unless you choose to commit it.

## Troubleshooting

**"N test file(s) are not in the merged reports"** — a shard's blob did not reach the merge
(check the upload and download steps, and that the merge waits for every shard), or the shards
read different timings files. Make sure all shards get the same copy, as the `plan` job above
does. If the shards ran with file filters or `--project`, the merge cannot apply them and checks the
whole config: set `requireAllFiles: false`.

**`.vitest-timings.json` is never written** — check that the merge command has no `--reporter`
flag (it replaces the config's reporters), that `TimingsReporter` is in `test.reporters`, and
that you are running `--merge-reports`, not a normal run.

**The split never changes** — the timings are not reaching the shards. Look for the restore step
finding a cache entry, and for the file existing before `vitest run --shard` starts.

**The first run is not balanced** — expected: with no timings the split is Vitest's own. The
second run is balanced.

**"--shard \<count\> must be a smaller than count of test files"** — Vitest's own check. Use fewer
shards than test files.

**Shards are still uneven** — the split is per file, so a shard can be no shorter than your
slowest file. See [Limitations](#limitations).

## Limitations

- **The unit is a file.** One file that takes a minute is a minute on whichever shard gets it.
  Split very slow files into several if they dominate.
- **Same machines assumed.** Timings from one runner size are used to plan another. Mixed runner
  types still work, just less evenly.
- **Startup is not modelled.** Every shard pays the same fixed cost (install, Vite start) on top of
  its files, so more shards stop paying off once that cost dominates.
- **A filtered sharded run cannot be checked.** `--merge-reports` ignores file filters and
  `--project`, so a merge of shards that ran a subset needs `requireAllFiles: false`, and then a
  lost shard goes unnoticed.
- **A shard with more than one worker** runs its files in parallel, so its wall time is less than
  the sum the plan balances. The split is still sensible, just not exact; with one worker per
  shard it is.

## Alternatives

| Approach                                                                                                                                                                  | Splits by                       | Notes                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Vitest `--shard` alone                                                                                                                                                    | path hash, equal file counts    | No setup; uneven when file costs differ.                                                            |
| **vitest-shard-balancer**                                                                                                                                                 | per-file duration, whole cost   | Inside Vitest; timings stay in your CI; completeness check.                                         |
| JUnit-based split actions ([split-tests-by-timings](https://github.com/r7kamura/split-tests-by-timings), [split-tests](https://github.com/scruplelesswizard/split-tests)) | test durations from JUnit XML   | Pass file lists on the command line; JUnit records test time only, not environment and import time. |
| [Knapsack Pro](https://knapsackpro.com)                                                                                                                                   | durations, with a dynamic queue | Hosted service: your file names and timings go to their API; paid plans.                            |

## Development

```sh
pnpm install
pnpm test           # unit tests and integration tests that run real sharded Vitest processes
pnpm typecheck
pnpm lint           # Biome
pnpm build          # tsc → dist/
pnpm lint:package   # publint + are-the-types-wrong on the packed tarball
```

The integration tests drive the fixture project in `test/fixture/` through real
`vitest --shard` and `--merge-reports` runs. CI runs the suite against Vitest 3.2, 4.1 and 5.0.

Releases are described in [PUBLISHING.md](./PUBLISHING.md).

## License

[MIT](./LICENSE) © Pavel Sidorov
