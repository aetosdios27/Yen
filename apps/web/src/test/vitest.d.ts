import type { AxeMatchers } from "vitest-axe/matchers";

declare module "vitest" {
  interface Assertion<T = unknown> extends AxeMatchers {
    // The matcher types ship with vitest-axe's legacy global augmentation,
    // which Vitest 5 no longer exposes. This keeps the matcher typed.
  }

  interface AsymmetricMatchersContaining extends AxeMatchers {
    // See Assertion above.
  }
}
