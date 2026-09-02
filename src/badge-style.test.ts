import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("activity badge appearance", () => {
  it("uses a fixed circular size with no outline and white text", () => {
    const badge = css.match(/\.count-badge\s*\{[^}]+\}/)?.[0] || "";
    expect(badge).toContain("width: var(--pet-badge-size, 28px)");
    expect(badge).toContain("padding: 0");
    expect(badge).toContain("border: 0");
    expect(badge).toContain("color: #fff");
    expect(badge).toContain("font-size: var(--pet-badge-font, 12px)");
  });
});
