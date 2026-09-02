import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("pet interaction surface", () => {
  it("keeps the hit target on the character instead of the expanded effect window", () => {
    expect(appSource).toContain('"--pet-character-size"');
    expect(css.match(/\.app-shell\s*\{[^}]+\}/)?.[0]).toContain("pointer-events: none");
    const surface = css.match(/\.pet-surface\s*\{[^}]+\}/)?.[0] || "";
    expect(surface).toContain("width: var(--pet-character-size)");
    expect(surface).toContain("height: var(--pet-character-size)");
    expect(surface).toContain("pointer-events: auto");
    const character = css.match(/\.grok-character\s*\{[^}]+\}/)?.[0] || "";
    expect(character).toContain("filter: drop-shadow");
  });

  it("sends the same screen-coordinate system for drag start and drag movement", () => {
    expect(appSource).toContain("window.pet.beginDrag({ x: event.screenX, y: event.screenY })");
    expect(appSource).toContain("window.pet.dragTo({ x: event.screenX, y: event.screenY })");
  });
});
