import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (relative: string) => {
  const url = new URL(relative, root);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};

describe("native macOS window bridge build", () => {
  it("implements a guarded Cocoa N-API binding", () => {
    const source = read("native/window-bridge/window_bridge.mm");
    expect(source).toContain("napi_get_buffer_info");
    expect(source).toContain("offsetWindow");
    expect(source).toContain("setAlwaysOnTop");
    expect(source).toContain("getWindowFrame");
    expect(source).toContain("NSScreenSaverWindowLevel");
    expect(source).toContain("NSNormalWindowLevel");
    expect(source).toContain("codexApprovalVisible");
    expect(source).toContain('bundleIdentifier isEqualToString:@"com.openai.codex"');
    expect(source).toContain("AXIsProcessTrustedWithOptions");
    expect(source).toContain("kAXWindowsAttribute");
    expect(source).not.toContain("napi_create_string");
  });

  it("fails closed for Accessibility ownership, visibility, cycles, and traversal limits", () => {
    const source = read("native/window-bridge/window_bridge.mm");
    const callback = source.slice(source.indexOf("napi_value CodexApprovalVisible"), source.indexOf("napi_value Init"));
    expect(source).toContain("class ScopedCF");
    expect(source).toContain("~ScopedCF");
    expect(source).toMatch(/ScopedCF<AXUIElementRef>\s+\w+\(AXUIElementCreateApplication/);
    expect(source).toContain("application.hidden");
    expect(source).toContain("kAXMinimizedAttribute");
    expect(source).toContain("CFSetContainsValue");
    expect(source).toContain("CFSetAddValue");
    expect(source).toContain("CFSetCreateMutable(kCFAllocatorDefault, 0, &kCFTypeSetCallBacks)");
    expect(source.indexOf("CFSetContainsValue")).toBeLessThan(source.indexOf("state.visitedCount += 1"));
    const copyCalls = source.match(/AXUIElementCopyAttributeValue\([^;]+/g) ?? [];
    expect(copyCalls.length).toBeGreaterThan(0);
    expect(copyCalls.every((call) => call.includes(".out()"))).toBe(true);
    expect(source).toMatch(/if \(depth > 12\) \{\s*state\.unavailable = true;/);
    expect(source).toMatch(/if \(state\.visitedCount >= 1500\) \{\s*state\.unavailable = true;/);
    expect(source).toMatch(/RequiredBooleanAttribute\([^;]+kAXHiddenAttribute/);
    expect(source).toMatch(/RequiredBooleanAttribute\([^;]+kAXMinimizedAttribute/);
    expect(source).not.toContain("BooleanAttribute(element, kAXHiddenAttribute, false)");
    expect(callback.indexOf("@try")).toBeGreaterThanOrEqual(0);
    expect(callback.indexOf("@try")).toBeLessThan(callback.indexOf("AccessibilityTrusted"));
    expect(callback).toContain("@catch (...)");
  });

  it("builds one Universal module for Intel and Apple Silicon", () => {
    const script = read("scripts/build-native-window-bridge.mjs");
    expect(script).toContain('"-bundle"');
    expect(script).toContain('"-arch", "arm64"');
    expect(script).toContain('"-arch", "x86_64"');
    expect(script).toContain('"-framework", "Cocoa"');
    expect(script).toContain('"-framework", "ApplicationServices"');
    expect(script).toContain("node_api.h");
    expect(script).toContain("window-bridge.node");
    expect(script).toContain("lipo");
  });

  it("runs the native build before development and production builds", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["build:native"]).toBe("node scripts/build-native-window-bridge.mjs");
    expect(pkg.scripts.predev).toContain("build:native");
    expect(pkg.scripts.build).toMatch(/^npm run build:native/);
    expect(pkg.build.extraResources).toContainEqual({
      from: "build/native/window-bridge.node",
      to: "native/window-bridge.node"
    });
  });

  it("verifies both packaged executables are Universal before distribution", () => {
    const script = read("scripts/package-mac-distribution.mjs");
    expect(script).toContain('"Contents", "MacOS", pkg.build.productName');
    expect(script).toContain('"Contents", "Resources", "native", "window-bridge.node"');
    expect(script.match(/assertUniversalBinary\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(script).toContain("Native window bridge");
  });

  it("ships a runtime smoke check for the packaged native bridge", () => {
    const script = read("scripts/smoke-native-window-bridge.cjs");
    expect(script).toContain("getNativeWindowHandle");
    expect(script).toContain("offsetWindow");
    expect(script).toContain("getWindowFrame");
    expect(script).toContain("setAlwaysOnTop");
    expect(script).toContain("window.setPosition(target.x, target.y, false)");
    expect(script).toContain("target.y - before.y");
    expect(script).toContain("native frame started at");
    expect(script).toContain('"Contents", "Resources", "native", "window-bridge.node"');
  });
});
