import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appIcon = readFileSync(new URL("../build/icon.svg", import.meta.url), "utf8");
const smallIcon = readFileSync(new URL("../build/icon-small.svg", import.meta.url), "utf8");
const trayLogo = readFileSync(new URL("../build/tray-logo.svg", import.meta.url), "utf8");

function pathData(svg: string) {
  return [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);
}

function pathCenter(path: string) {
  const coordinates = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const xs = coordinates.filter((_, index) => index % 2 === 0);
  const ys = coordinates.filter((_, index) => index % 2 === 1);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2
  };
}

function numericAttribute(element: string, name: string) {
  return Number(element.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]);
}

describe("app icon artwork", () => {
  it("reuses every character path from the tray logo", () => {
    for (const path of pathData(trayLogo)) expect(appIcon).toContain(`d="${path}"`);
  });

  it("keeps the tray logo eye paths at their original positions", () => {
    for (const eyePath of pathData(trayLogo).slice(0, 2)) {
      const pathStart = appIcon.lastIndexOf("<path", appIcon.indexOf(`d="${eyePath}"`));
      const pathEnd = appIcon.indexOf("/>", pathStart);
      expect(appIcon.slice(pathStart, pathEnd)).not.toContain("transform=");
    }
  });

  it("places the black character on the approved light neutral background", () => {
    expect(appIcon).toContain('id="background"');
    expect(appIcon).toContain("#f8f7f3");
    expect(appIcon).toContain("#dfe4ec");
  });

  it("keeps small-artwork eye centers aligned with the scaled tray logo", () => {
    pathData(trayLogo).slice(0, 2).forEach((eyePath, index) => {
      const eye = smallIcon.match(new RegExp(`<rect\\b[^>]*\\bid="tray-eye-${index + 1}"[^>]*/>`))?.[0] || "";
      const center = pathCenter(eyePath);
      expect(numericAttribute(eye, "x") + numericAttribute(eye, "width") / 2).toBeCloseTo(169 + center.x * 3, 0);
      expect(numericAttribute(eye, "y") + numericAttribute(eye, "height") / 2).toBeCloseTo(135 + center.y * 3, 0);
    });
  });
});
