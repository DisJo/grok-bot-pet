import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BODY_INK, GrokCharacter, statusColorBehavior, statusPulseInk } from "./GrokCharacter";
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

describe("task status color pulse", () => {
  it("breathes for every task status color", () => {
    expect(([
      "completed", "error", "stopped", "waiting"
    ] as const).map((role) => statusColorBehavior(role))).toEqual([
      "breathe", "breathe", "breathe", "breathe"
    ]);
  });

  it("breathes smoothly from the base color to the full status color and back", () => {
    const statusInk = "#e02135";
    const baseInk = "#000000";

    expect([
      0, 600, 1200, 1800, 2400
    ].map((elapsed) => statusPulseInk(elapsed, statusInk, baseInk, false))).toEqual([
      baseInk, "#70111b", statusInk, "#70111b", baseInk
    ]);
  });

  it("holds the status color when reduced motion is requested", () => {
    expect(statusPulseInk(170, "#e02135", "#000000", true)).toBe("#e02135");
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
      baseBodyColor: "black",
      eyeColor: "#ffffff"
    }));
    expect(html).toContain("width:64px");
    expect(html).toContain("height:64px");
  });
});
