import { expect, it } from "vitest";

it("takes 200 ms", async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(true).toBe(true);
});
