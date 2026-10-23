import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fileKey, readTimings, smoothTimings, writeTimings } from "../src/timings.js";

function tempFile(content?: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "shard-balancer-")), "timings.json");
  if (content !== undefined) writeFileSync(file, content);
  return file;
}

describe("readTimings", () => {
  it("reads a missing file as no timings, without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readTimings(tempFile())).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{"],
    ["an array", "[1, 2]"],
    ["null", "null"],
    ["a number", "42"],
  ])("ignores %s with a warning", (_, content) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readTimings(tempFile(content))).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });

  it("drops entries that are not finite non-negative numbers", () => {
    const file = tempFile(JSON.stringify({ ok: 12, zero: 0, neg: -1, text: "5", none: null }));
    expect(readTimings(file)).toEqual({ ok: 12, zero: 0 });
  });
});

describe("smoothTimings", () => {
  it("blends a known key by the weight and takes a new key as measured", () => {
    expect(smoothTimings({ a: 100 }, { a: 200, b: 50 }, 0.5)).toEqual({ a: 150, b: 50 });
  });

  it("keeps only the measured keys, so a deleted file drops out", () => {
    expect(smoothTimings({ gone: 10, a: 10 }, { a: 10 }, 0.5)).toEqual({ a: 10 });
  });

  it("keeps an unmeasured key unchanged while its file still exists", () => {
    const existing = new Set(["a", "skipped"]);
    expect(smoothTimings({ gone: 10, skipped: 40, a: 100 }, { a: 200 }, 0.5, existing)).toEqual({
      skipped: 40,
      a: 150,
    });
  });

  it("with weight 1 keeps only the latest measurement", () => {
    expect(smoothTimings({ a: 100 }, { a: 300 }, 1)).toEqual({ a: 300 });
  });

  it.each([0, -0.1, 1.1, Number.NaN])("refuses weight %s", (weight) => {
    expect(() => smoothTimings({}, {}, weight)).toThrow(RangeError);
  });
});

describe("writeTimings", () => {
  it("writes keys sorted, so the file diffs cleanly, and round-trips through readTimings", () => {
    const file = tempFile();
    writeTimings(file, { b: 2, a: 1 });
    expect(readFileSync(file, "utf8")).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
    expect(readTimings(file)).toEqual({ a: 1, b: 2 });
  });
});

describe("fileKey", () => {
  it("is the path relative to the root, prefixed by the project name when there is one", () => {
    const root = path.resolve("/repo");
    const file = path.join(root, "tests", "a.test.ts");
    expect(fileKey(root, file, "")).toBe("tests/a.test.ts");
    expect(fileKey(root, file, "unit")).toBe("unit:tests/a.test.ts");
  });
});
