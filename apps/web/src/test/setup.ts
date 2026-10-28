import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import * as matchers from "vitest-axe/matchers";

expect.extend(matchers);

afterEach(() => {
  if (typeof document === "undefined") {
    return;
  }
  cleanup();
  document.documentElement.lang = "en";
});
