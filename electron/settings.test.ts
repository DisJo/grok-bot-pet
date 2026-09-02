import { describe, expect, it } from "vitest";
import { DEFAULT_STATUS_COLORS, normalizeSettings } from "./settings";

describe("settings migration", () => {
  it("does not expose a persisted animation off switch", () => {
    expect(normalizeSettings({ animations: false } as never)).not.toHaveProperty("animations");
  });

  it("drops the obsolete single-skin setting from normalized output", () => {
    expect(normalizeSettings({ skin: "grok" } as never)).not.toHaveProperty("skin");
  });

  it("enables all character shadows by default and preserves an explicit opt-out", () => {
    expect(normalizeSettings({}).shadowsEnabled).toBe(true);
    expect(normalizeSettings({ shadowsEnabled: false }).shadowsEnabled).toBe(false);
  });

  it("uses yellow as the default waiting status color", () => {
    expect(normalizeSettings({}).statusColors.waiting).toBe("yellow");
  });

  it("replaces the development-build orange waiting default once", () => {
    const normalized = normalizeSettings({
      settingsVersion: 4,
      statusColors: { ...DEFAULT_STATUS_COLORS, waiting: "orange" }
    });
    expect(normalized.statusColors.waiting).toBe("yellow");
    expect(normalized.settingsVersion).toBe(5);
  });

  it("adds result colors without overwriting existing character preferences", () => {
    const migrated = normalizeSettings({
      settingsVersion: 2,
      bodyColor: "violet",
      eyeColor: "#9fc9ff",
      autoShape: true,
      fixedShape: "gem"
    });
    expect(migrated.settingsVersion).toBe(5);
    expect(migrated.statusColorsEnabled).toBe(true);
    expect(migrated.statusColors).toEqual(DEFAULT_STATUS_COLORS);
    expect(migrated.bodyColor).toBe("violet");
    expect(migrated.eyeColor).toBe("#9fc9ff");
    expect(migrated.autoShape).toBe(true);
    expect(migrated.fixedShape).toBe("gem");
  });

  it("preserves customized status colors and fills missing roles", () => {
    const migrated = normalizeSettings({
      settingsVersion: 3,
      statusColorsEnabled: false,
      statusColors: { ...DEFAULT_STATUS_COLORS, completed: "yellow" }
    });
    expect(migrated.statusColorsEnabled).toBe(false);
    expect(migrated.statusColors.completed).toBe("yellow");
    expect(migrated.statusColors.error).toBe("red");
  });

  it("migrates the three legacy size presets to continuous pixel values", () => {
    expect(normalizeSettings({ settingsVersion: 3, characterSize: "compact" }).characterSize).toBe(224);
    expect(normalizeSettings({ settingsVersion: 3, characterSize: "standard" }).characterSize).toBe(270);
    expect(normalizeSettings({ settingsVersion: 3, characterSize: "large" }).characterSize).toBe(310);
    expect(normalizeSettings({ settingsVersion: 5, characterSize: 999 }).characterSize).toBe(320);
  });

  it("allows a desktop-icon-sized 64px character without accepting smaller values", () => {
    expect(normalizeSettings({ settingsVersion: 5, characterSize: 64 }).characterSize).toBe(64);
    expect(normalizeSettings({ settingsVersion: 5, characterSize: 12 }).characterSize).toBe(64);
  });
});
