import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const fixture = path.resolve(import.meta.dirname, "fixture");
const vitestBin = path.resolve(import.meta.dirname, "../node_modules/vitest/vitest.mjs");
const SHARDS = 3;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "shard-balancer-it-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function vitest(
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ code: number; output: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    TIMINGS_FILE: path.join(dir, "timings.json"),
  };
  delete env.VITEST;
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [vitestBin, "run", "--root", fixture, ...args],
      { env },
    );
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, output: stdout + stderr };
  }
}

async function runShards(count = SHARDS, filters: string[] = []): Promise<string[][]> {
  rmSync(path.join(dir, "blobs"), { recursive: true, force: true });
  const shards: string[][] = [];
  for (let i = 1; i <= count; i++) {
    const json = path.join(dir, `shard-${i}.json`);
    const { code } = await vitest([
      ...filters,
      `--shard=${i}/${count}`,
      "--reporter=blob",
      "--reporter=json",
      `--outputFile.blob=${path.join(dir, "blobs", `blob-${i}.json`)}`,
      `--outputFile.json=${json}`,
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(readFileSync(json, "utf8")) as { testResults: { name: string }[] };
    shards.push(report.testResults.map((r) => path.relative(fixture, r.name)).sort());
  }
  return shards;
}

const timings = (): Record<string, number> =>
  JSON.parse(readFileSync(path.join(dir, "timings.json"), "utf8"));

const merge = (extraEnv?: NodeJS.ProcessEnv) =>
  vitest([`--merge-reports=${path.join(dir, "blobs")}`], extraEnv);

describe("a sharded run, merged and run again", () => {
  it("records every file on the merge and then gives the heaviest file a shard of its own", async () => {
    const first = await runShards();
    expect(first.flat().sort()).toHaveLength(5);

    expect((await merge()).code).toBe(0);
    expect(Object.keys(timings()).sort()).toEqual(first.flat().sort());
    expect(timings()["tests/heavy.test.ts"]).toBeGreaterThanOrEqual(600);

    const second = await runShards();
    expect(second.flat().sort()).toEqual(first.flat().sort());
    expect(second).toContainEqual(["tests/heavy.test.ts"]);
  });

  it("fails the merge and names the file when a shard's report is missing", async () => {
    await runShards();
    rmSync(path.join(dir, "blobs", "blob-1.json"));
    const result = await merge();
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/not in the merged reports[\s\S]*tests\/\S+\.test\.ts/);
    expect(() => timings()).toThrow();
  });

  it("writes nothing on a run that is not a merge", async () => {
    await runShards();
    expect(() => timings()).toThrow();
  });
});

describe("shards filtered to part of the suite", () => {
  const filters = ["tests/light"];

  it("fails the merge and points at the filters", async () => {
    await runShards(2, filters);
    const result = await merge();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("tests/heavy.test.ts");
    expect(result.output).toContain("requireAllFiles: false");
  });

  it("with requireAllFiles off, updates the covered files and keeps the rest", async () => {
    await runShards();
    expect((await merge()).code).toBe(0);
    const full = timings();
    expect(Object.keys(full)).toHaveLength(5);

    await runShards(2, filters);
    expect((await merge({ REQUIRE_ALL_FILES: "false" })).code).toBe(0);
    expect(Object.keys(timings()).sort()).toEqual(Object.keys(full).sort());
    expect(timings()["tests/heavy.test.ts"]).toBe(full["tests/heavy.test.ts"]);
  });
});
