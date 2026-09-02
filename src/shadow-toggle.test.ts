import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("unified character shadow switch", () => {
  it("exposes one settings-panel toggle", () => {
    expect(panelSource).toContain("label={copy.shadows}");
    expect(panelSource).toContain("checked={settings.shadowsEnabled}");
    expect(panelSource).toContain("update({ shadowsEnabled: checked })");
  });

  it("disables the body drop shadow, ground shadow, and badge shadow together", () => {
    expect(appSource).toContain('settings.shadowsEnabled ? "shadows-enabled" : "shadows-disabled"');
    expect(css).toMatch(/\.shadows-disabled\s+\.grok-character\s*\{[^}]*filter:\s*none/);
    expect(css).toMatch(/\.shadows-disabled\s+\.pet-shadow\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.shadows-disabled\s+\.count-badge\s*\{[^}]*box-shadow:\s*none/);
  });
});
