import { expect, it } from "vitest";

it("takes 100 ms", async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(true).toBe(true);
});
