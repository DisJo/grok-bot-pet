import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as settingsPanel from "./SettingsPanel";
import SettingsPanel from "./SettingsPanel";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || "";
}

describe("settings panel layout", () => {
  it("uses a frameless surface without any outer border or shadow", () => {
    const panel = rule(".settings-panel");
    expect(panel).toContain("border: 0");
    expect(panel).toContain("box-shadow: none");
    expect(panel).not.toContain("inset");
    expect(css.match(/\.settings-panel\s*\{[^}]*box-shadow:[^;}]+/g) || []).toEqual([
      expect.stringContaining("box-shadow: none"),
      expect.stringContaining("box-shadow: none")
    ]);
  });

  it("keeps all eleven body colors on one row", () => {
    const bodyColors = rule(".body-swatches");
    expect(bodyColors).toContain("grid-template-columns: repeat(11");
    expect(bodyColors).toContain("display: grid");
  });

  it("uses the tray logo artwork for the settings panel brand mark", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { GROK_GEO: { shapes: {} } }
    });
    const markup = renderToStaticMarkup(createElement(SettingsPanel, { systemLocale: "en" }));
    expect(markup).toContain('<img class="brand-mark" src="data:image/svg+xml');
    expect(markup).toContain('alt="" aria-hidden="true"');
    expect(css).not.toContain(".brand-mark span");
  });

  it("gives the single settings scroller the whole panel height", () => {
    const scroll = rule(".settings-scroll");
    expect(scroll).toContain("height: 100%");
    expect(scroll).toContain("overflow-y: auto");
    expect(rule(".settings-content")).toContain("padding: 11px 12px 22px");
  });

  it("returns the menu to its first option whenever it opens", () => {
    const resetSettingsScroll = (settingsPanel as { resetSettingsScroll?: (scroll: { scrollTop: number }) => void }).resetSettingsScroll;
    expect(resetSettingsScroll).toBeTypeOf("function");
    if (!resetSettingsScroll) return;
    const scroll = { scrollTop: 318 };
    resetSettingsScroll(scroll);
    expect(scroll.scrollTop).toBe(0);
  });
});
