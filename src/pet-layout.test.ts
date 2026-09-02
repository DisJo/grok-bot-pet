import { describe, expect, it } from "vitest";
import { petLayout } from "./pet-layout";

describe("pet visual layout", () => {
  it("keeps the badge fixed and outside a 64px desktop-icon-sized character", () => {
    expect(petLayout(64)).toEqual({
      characterSize: 64,
      windowMargin: 63,
      shadowWidth: 36,
      shadowHeight: 6,
      shadowBottom: -3,
      shadowBlur: 3,
      dropY: 5,
      dropBlur: 6,
      badgeSize: 28,
      badgeInset: -20,
      badgeBorder: 0,
      badgeFont: 12,
      badgePadding: 7
    });
  });

  it("preserves the established proportions at the default 270px size", () => {
    expect(petLayout(270)).toEqual({
      characterSize: 270,
      windowMargin: 235,
      shadowWidth: 152,
      shadowHeight: 22,
      shadowBottom: -11,
      shadowBlur: 11,
      dropY: 20,
      dropBlur: 24,
      badgeSize: 28,
      badgeInset: 10,
      badgeBorder: 0,
      badgeFont: 12,
      badgePadding: 7
    });
  });

  it("does not scale the badge while the character size changes", () => {
    const compact = petLayout(64);
    const large = petLayout(320);
    expect(compact.badgeSize).toBe(large.badgeSize);
    expect(compact.badgeFont).toBe(large.badgeFont);
    expect(compact.badgePadding).toBe(large.badgePadding);
    expect(compact.badgeBorder).toBe(0);
  });

  it("reserves enough native-window overscan for particles, ribbons and the CSS drop shadow", () => {
    for (const size of [64, 250, 270, 320]) {
      const layout = petLayout(size);
      expect(layout.windowMargin).toBeGreaterThanOrEqual(
        Math.ceil(layout.characterSize * 0.5) + 4 + layout.dropY + layout.dropBlur * 3 + 4
      );
      expect(layout.windowMargin).toBeGreaterThanOrEqual(Math.round(layout.shadowHeight / 2) + layout.shadowBlur * 4 + 4);
      expect(layout.shadowBottom + Math.round(layout.shadowHeight / 2)).toBe(0);
    }
  });
});
