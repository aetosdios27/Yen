import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { formatMessage, getMessage, translate } from "./translate";

describe("translate", () => {
  it("resolves nested keys in every catalogue", () => {
    expect(getMessage(catalog.en, "status.verified")).toBe("Verified");
    expect(getMessage(catalog.hi, "status.verified")).toBe("सत्यापित");
    expect(getMessage(catalog["en-XA"], "status.verified")).toContain("⟦");
  });

  it("interpolates values in English and Hindi", () => {
    expect(
      translate("en", "stepper.step", {
        current: 2,
        total: 3,
        label: "Approvers",
      }),
    ).toBe("Step 2 of 3: Approvers");
    expect(
      translate("hi", "stepper.step", {
        current: 2,
        total: 3,
        label: "स्वीकृतकर्ता",
      }),
    ).toBe("चरण 2 / 3: स्वीकृतकर्ता");
  });

  it("leaves unknown placeholders visible", () => {
    expect(formatMessage("Hello {name}, {missing}", { name: "Asha" })).toBe(
      "Hello Asha, {missing}",
    );
  });

  it("expands the pseudo-locale without breaking interpolation", () => {
    const message = translate("en-XA", "stepper.step", {
      current: 2,
      total: 3,
      label: "Approvers",
    });

    expect(message).toContain("⟦");
    expect(message).toContain("2");
    expect(message).toContain("Approvers");
    expect(message).not.toContain("{");
  });
});
