// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

const TOKENS = new Map<string, string>();
for (const match of CSS.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
  const name = match[1];
  const value = match[2];
  if (name !== undefined && value !== undefined) {
    TOKENS.set(name, value.trim());
  }
}

function token(name: string): string {
  const value = TOKENS.get(name);
  if (value === undefined) {
    throw new Error(`Missing token --${name}`);
  }
  return value;
}

function hex(name: string): string {
  const value = token(name);
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Token --${name} is not a six-digit hex colour: ${value}`);
  }
  return value;
}

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(colour: string): number {
  const red = linear(Number.parseInt(colour.slice(1, 3), 16) / 255);
  const green = linear(Number.parseInt(colour.slice(3, 5), 16) / 255);
  const blue = linear(Number.parseInt(colour.slice(5, 7), 16) / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function expectContrast(foreground: string, background: string, minimum: number): void {
  expect(
    contrast(hex(foreground), hex(background)),
    `${foreground} on ${background} must be at least ${minimum}:1`,
  ).toBeGreaterThanOrEqual(minimum);
}

function remToPx(value: string): number {
  const match = /^([\d.]+)rem$/.exec(value);
  if (match === null) {
    throw new Error(`Expected a rem value, got ${value}`);
  }
  return Number(match[1] ?? Number.NaN) * 16;
}

describe("design tokens", () => {
  it("keeps body and supporting text at 16 px or larger", () => {
    expect(remToPx(token("text-body"))).toBeGreaterThanOrEqual(16);
    expect(remToPx(token("text-small"))).toBeGreaterThanOrEqual(16);
  });

  it("keeps interactive targets at 48 px and the phone frame at 375 px", () => {
    expect(remToPx(token("spacing-tap"))).toBeGreaterThanOrEqual(48);
    expect(remToPx(token("container-phone"))).toBe(375);
  });

  it("meets 7:1 for text, actions and every status", () => {
    expectContrast("color-ink", "color-canvas", 7);
    expectContrast("color-primary", "color-canvas", 7);
    expectContrast("color-on-solid", "color-primary", 7);
    expectContrast("color-on-solid", "color-danger", 7);
    expectContrast("color-verified-ink", "color-verified-bg", 7);
    expectContrast("color-pending-ink", "color-pending-bg", 7);
    expectContrast("color-unmatched-ink", "color-unmatched-bg", 7);
    expectContrast("color-rejected-ink", "color-rejected-bg", 7);
  });

  it("meets 4.5:1 for supporting text", () => {
    expectContrast("color-ink-muted", "color-canvas", 4.5);
    expectContrast("color-ink-muted", "color-surface", 4.5);
  });

  it("meets 3:1 for focus rings and control borders", () => {
    expectContrast("color-focus", "color-canvas", 3);
    expectContrast("color-border-strong", "color-canvas", 3);
  });
});
