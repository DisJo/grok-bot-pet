import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../electron/preload.ts", import.meta.url), "utf8");

describe("character size slider", () => {
  it("previews and commits entirely in the renderer without a native resize session", () => {
    expect(panelSource).not.toContain("beginCharacterResize");
    expect(panelSource).not.toContain("onBegin");
    expect(preloadSource).not.toContain("settings:beginCharacterResize");
    expect(panelSource).toContain("onPreview={(value) => preview({ characterSize: value })}");
    expect(panelSource).toContain("onCommit={(value) => update({ characterSize: value })}");
  });
});
