import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import SettingsPanel from "./SettingsPanel";

describe("settings version footer", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { GROK_GEO: { shapes: {} } }
    });
  });

  it("keeps an app-version placeholder visible while Electron supplies the packaged version", () => {
    const html = renderToStaticMarkup(<SettingsPanel systemLocale="zh-CN" />);
    expect(html).toContain('class="app-version"');
    expect(html).toContain("版本 …");
  });

  it("renders English settings copy for every non-Chinese system language", () => {
    const html = renderToStaticMarkup(<SettingsPanel systemLocale="fr-FR" />);
    expect(html).toContain("Codex disconnected");
    expect(html).toContain("Hide pet");
    expect(html).toContain("Appearance");
    expect(html).toContain("Version …");
    expect(html).not.toMatch(/[一-龥]/);
  });

  it("uses the locale synchronously supplied by the Electron preload", () => {
    (window as unknown as { pet: { appLocale: string } }).pet = { appLocale: "en" };
    const html = renderToStaticMarkup(<SettingsPanel />);
    expect(html).toContain("Codex disconnected");
    expect(html).not.toMatch(/[一-龥]/);
  });

  it("keeps Chinese settings copy for Chinese system languages", () => {
    const html = renderToStaticMarkup(<SettingsPanel systemLocale="zh-HK" />);
    expect(html).toContain("Codex 未连接");
    expect(html).toContain("隐藏宠物");
    expect(html).toContain("外观");
    expect(html).toContain("版本 …");
  });
});
