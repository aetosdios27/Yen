import { expect, it } from "vitest";
import * as packageExports from "./index.js";

it("reserves an empty package for future implementation", () => {
  expect(Object.keys(packageExports)).toEqual([]);
});
