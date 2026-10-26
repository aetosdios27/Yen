import { expect, it } from "vitest";
import { paiseWire } from "./paise-wire.js";

it.each(["0", "1", "9007199254740993"])("preserves paise %s exactly", (value) => {
  expect(paiseWire.parse(value)).toBe(value);
  expect(BigInt(paiseWire.parse(value)).toString()).toBe(value);
});

it.each(["-1", "1.5", "01", "", "+1", "1e3", " 1", 0, 9007199254740992, null])(
  "rejects noncanonical paise %s",
  (value) => expect(paiseWire.safeParse(value).success).toBe(false),
);
