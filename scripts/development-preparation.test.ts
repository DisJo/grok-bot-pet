import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("development preparation", () => {
  it("builds the native bridge without rasterizing checked-in icons", () => {
    const projectRoot = process.cwd();

    execFileSync("npm", ["run", "predev"], { cwd: projectRoot, stdio: "pipe" });

    expect(existsSync(path.join(projectRoot, "build", "native", "window-bridge.node"))).toBe(true);
  });
});
