import { expect, it } from "vitest";

it("takes 600 ms", async () => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(true).toBe(true);
});
