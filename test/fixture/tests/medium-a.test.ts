import { expect, it } from "vitest";

it("takes 300 ms", async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(true).toBe(true);
});
