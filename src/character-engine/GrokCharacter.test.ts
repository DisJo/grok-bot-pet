import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BODY_INK, GrokCharacter } from "./GrokCharacter";
import * as grokCharacter from "./GrokCharacter";

describe("Grok character motion policy", () => {
  it("reduces motion only when macOS requests it", () => {
    const prefersReducedMotion = (grokCharacter as { prefersReducedMotion?: (matchMedia: (query: string) => { matches: boolean }) => boolean }).prefersReducedMotion;
    expect(prefersReducedMotion).toBeTypeOf("function");
    if (!prefersReducedMotion) return;
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
  });
});

describe("Grok character color palette", () => {
  it("renders yellow as a visually distinct yellow rather than orange", () => {
    expect(BODY_INK.yellow).toBe("#ffd60a");
    expect(BODY_INK.yellow).not.toBe(BODY_INK.orange);
  });
});

describe("Grok character size", () => {
  it("renders at the 64px desktop-icon minimum", () => {
    const html = renderToStaticMarkup(createElement(GrokCharacter, {
      directive: { state: "idle", shape: "blob", emphasis: false, priority: 1 },
      pointerFollowing: false,
      gaze: { x: 0, y: 0 },
      size: 12,
      bodyColor: "black",
      eyeColor: "#ffffff"
    }));
    expect(html).toContain("width:64px");
    expect(html).toContain("height:64px");
  });
});
