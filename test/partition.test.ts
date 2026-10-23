import { describe, expect, it } from "vitest";
import { partition } from "../src/partition.js";

describe("partition", () => {
  it("puts the heaviest keys on separate groups and fills the lightest group next", () => {
    const timings = { a: 600, b: 300, c: 300, d: 200, e: 100 };
    expect(partition(Object.keys(timings), timings, 3)).toEqual([["a"], ["b", "d"], ["c", "e"]]);
  });

  it("returns undefined when no key has a timing, so the caller can fall back", () => {
    expect(partition(["a", "b"], { other: 10 }, 2)).toBeUndefined();
    expect(partition([], {}, 2)).toBeUndefined();
  });

  it("weighs a key with no timing as the median of the known ones", () => {
    const groups = partition(["slow", "mid", "fast", "new"], { slow: 900, mid: 500, fast: 100 }, 2);
    expect(groups).toEqual([
      ["slow", "fast"],
      ["mid", "new"],
    ]);
  });

  it("ignores timings for keys that are not being split", () => {
    const groups = partition(["a", "b"], { a: 10, b: 10, gone: 1_000_000 }, 2);
    expect(groups).toEqual([["a"], ["b"]]);
  });

  it("is independent of the input order", () => {
    const timings = { a: 5, b: 5, c: 5, d: 5, e: 7 };
    const keys = Object.keys(timings);
    expect(partition([...keys].reverse(), timings, 2)).toEqual(partition(keys, timings, 2));
  });

  it("assigns every key exactly once, leaving extra groups empty", () => {
    const groups = partition(["a", "b", "a"], { a: 1, b: 2 }, 4);
    expect(groups).toEqual([["b"], ["a"], [], []]);
  });

  it("leaves no group empty when some timings are zero", () => {
    const groups = partition(["a", "b", "c"], { a: 0, b: 0, c: 0 }, 3);
    expect(groups).toEqual([["a"], ["b"], ["c"]]);
  });

  it("refuses a count that is not a positive integer", () => {
    expect(() => partition(["a"], { a: 1 }, 0)).toThrow(RangeError);
    expect(() => partition(["a"], { a: 1 }, 1.5)).toThrow(RangeError);
  });
});
