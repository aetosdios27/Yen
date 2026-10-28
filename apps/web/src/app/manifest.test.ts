// @vitest-environment node

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const TOKENS_CSS = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

function getToken(name: string): string {
  const regex = new RegExp(`--${name}:\\s*([^;]+);`);
  const match = regex.exec(TOKENS_CSS);
  if (!match?.[1]) {
    throw new Error(`Token --${name} not found in tokens.css`);
  }
  return match[1].trim();
}

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (!isPng) {
    throw new Error(`File is not a valid PNG: ${filePath}`);
  }
  // IHDR width and height at offset 16 and 20 (big-endian 32-bit uint)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

describe("manifest configuration and tokens", () => {
  const data = manifest();

  it("contains all required PWA manifest fields", () => {
    expect(data.name).toBe("Yen");
    expect(data.short_name).toBe("Yen");
    expect(data.description).toBe("Community money you can check.");
    expect(data.start_url).toBe("/");
    expect(data.scope).toBe("/");
    expect(data.display).toBe("standalone");
    expect(data.lang).toBe("en");
  });

  it("matches theme and background colors from design tokens", () => {
    const primaryToken = getToken("color-primary");
    const canvasToken = getToken("color-canvas");

    expect(data.theme_color).toBe(primaryToken);
    expect(data.background_color).toBe(canvasToken);
  });

  it("configures standard and maskable icons that exist on disk with correct sizes", () => {
    const icons = data.icons;
    expect(icons).toBeDefined();
    expect(icons?.length).toBeGreaterThanOrEqual(3);

    const publicDir = resolve(new URL(".", import.meta.url).pathname, "../../public");

    let has192 = false;
    let has512 = false;
    let hasMaskable = false;

    for (const icon of icons ?? []) {
      expect(icon.src.startsWith("/")).toBe(true);
      const relativePath = icon.src.replace(/^\//, "");
      const fullPath = resolve(publicDir, relativePath);

      expect(existsSync(fullPath), `Icon file must exist: ${icon.src}`).toBe(true);
      const stat = statSync(fullPath);
      expect(stat.size).toBeGreaterThan(0);

      const [expectedW, expectedH] = (icon.sizes ?? "").split("x").map(Number);
      const dims = readPngDimensions(fullPath);
      expect(dims.width).toBe(expectedW);
      expect(dims.height).toBe(expectedH);

      if (icon.sizes === "192x192" && icon.purpose === "any") has192 = true;
      if (icon.sizes === "512x512" && icon.purpose === "any") has512 = true;
      if (icon.sizes === "512x512" && icon.purpose === "maskable") hasMaskable = true;
    }

    expect(has192, "192x192 any icon is required").toBe(true);
    expect(has512, "512x512 any icon is required").toBe(true);
    expect(hasMaskable, "512x512 maskable icon is required").toBe(true);
  });
});
