import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import App from "./App";
import SettingsPanel from "./SettingsPanel";

describe("shared renderer defaults", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { GROK_GEO: { shapes: {} } }
    });
  });

  it("starts the pet and settings slider at the persisted 270px default", () => {
    const pet = renderToStaticMarkup(<App />);
    const settings = renderToStaticMarkup(<SettingsPanel systemLocale="en" />);

    expect(pet).toContain("--pet-character-size:270px");
    expect(settings).toContain('value="270"');
    expect(settings).toContain("270px");
  });
});
