import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as settingsPanel from "./SettingsPanel";

describe("settings toggle control", () => {
  it("uses a button switch instead of a focusable off-layout checkbox", () => {
    const Toggle = (settingsPanel as { Toggle?: ComponentType<{ label: string; checked: boolean; onChange(value: boolean): void }> }).Toggle;
    expect(Toggle).toBeTypeOf("function");
    if (!Toggle) return;

    const markup = renderToStaticMarkup(createElement(Toggle, {
      label: "Show shadows",
      checked: true,
      onChange: () => undefined
    }));

    expect(markup).toContain("<button");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).not.toContain("<input");
  });
});
