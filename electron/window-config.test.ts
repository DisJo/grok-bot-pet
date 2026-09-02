import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("settings window configuration", () => {
  it("uses global pointer polling to activate only the visible character hit target", () => {
    const petWindow = mainSource.match(/function createWindow\(\)[\s\S]*?function createSettingsWindow/)?.[0] || "";
    const pointerTracking = mainSource.match(/function startPointerTracking\(\)[\s\S]*?function createTray/)?.[0] || "";
    expect(petWindow).toContain("setIgnoreMouseEvents(true, { forward: true })");
    expect(pointerTracking).toContain("petHitTargetContains(cursor, bounds, petOffset, settings.characterSize)");
    expect(mainSource).toContain("setIgnoreMouseEvents(!active, { forward: true })");
    expect(mainSource).not.toContain('ipcMain.on("window:setPetHitTarget"');
  });

  it("does not let macOS draw a native shadow around the transparent panel", () => {
    const settingsWindow = mainSource.match(/function createSettingsWindow\(\)[\s\S]*?function positionSettingsWindow/)?.[0] || "";
    expect(settingsWindow).toContain("hasShadow: false");
    expect(settingsWindow).toContain("setHasShadow(false)");
    expect(settingsWindow).not.toContain("hasShadow: true");
  });

  it("shows the packaged version in the native status menu", () => {
    const trayMenu = mainSource.match(/function rebuildTrayMenu\(\)[\s\S]*?function truncate/)?.[0] || "";
    expect(trayMenu).toContain("copy.version(app.getVersion())");
  });

  it("offers one native menu switch for every character shadow", () => {
    const trayMenu = mainSource.match(/function rebuildTrayMenu\(\)[\s\S]*?function truncate/)?.[0] || "";
    expect(trayMenu).toContain("label: copy.shadows");
    expect(trayMenu).toContain("checked: settings.shadowsEnabled");
    expect(trayMenu).toContain("applySettings({ shadowsEnabled: item.checked })");
  });

  it("never resizes the transparent native window while using the size slider", () => {
    const preview = mainSource.match(/function previewSettings\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    const merge = mainSource.match(/function mergeSettings\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    expect(preview).not.toContain("mergeSettings");
    expect(preview).toContain("normalizeSettings");
    expect(preview).not.toContain("resizePetWindow");
    expect(merge).not.toContain("resizePetWindow");
    expect(preview).not.toContain("rebuildTrayMenu");
    expect(preview).not.toContain("setLoginItemSettings");
    expect(preview).not.toContain("setAlwaysOnTop");
    expect(mainSource).not.toContain("beginCharacterResize");
    expect(mainSource).toContain("petWindowSize(320)");
  });

  it("does not replay unrelated native side effects for renderer-only settings", () => {
    const merge = mainSource.match(/function mergeSettings\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    expect(merge).toContain("if (patch.alwaysOnTop !== undefined && win)");
    expect(merge).toContain("if (patch.opacity !== undefined) win?.setOpacity(settings.opacity)");
    expect(merge).toContain("if (patch.launchAtLogin !== undefined) app.setLoginItemSettings");
  });

  it("keeps the settings panel above the screen-saver-level pet window", () => {
    const settingsWindow = mainSource.match(/function createSettingsWindow\(\)[\s\S]*?function positionSettingsWindow/)?.[0] || "";
    const showSettings = mainSource.match(/function showSettingsPanel\(\)[\s\S]*?function toggleSettingsPanel/)?.[0] || "";
    expect(settingsWindow).toContain('setAlwaysOnTop(true, "screen-saver", 2)');
    expect(showSettings).toContain("panel.moveTop()");
  });

  it("uses the renderer pointer coordinates consistently for the whole drag", () => {
    const dragHandlers = mainSource.match(/ipcMain\.on\("window:beginDrag"[\s\S]*?ipcMain\.on\("window:endDrag"/)?.[0] || "";
    expect(dragHandlers).toContain('ipcMain.on("window:beginDrag", (_event, pointer: PetPoint)');
    expect(dragHandlers).toContain('ipcMain.on("window:dragTo", (_event, pointer: PetPoint)');
    expect(dragHandlers).toContain("isFinitePoint");
    expect(dragHandlers).not.toContain("screen.getCursorScreenPoint()");
  });

  it("uses native always-on-top and logical bounds across the complete display", () => {
    const petWindow = mainSource.match(/function createWindow\(\)[\s\S]*?function createSettingsWindow/)?.[0] || "";
    const mergeSettings = mainSource.match(/function mergeSettings\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    const pointerTracking = mainSource.match(/function startPointerTracking\(\)[\s\S]*?function createTray/)?.[0] || "";
    const dragHandlers = mainSource.match(/ipcMain\.on\("window:beginDrag"[\s\S]*?ipcMain\.on\("window:endDrag"/)?.[0] || "";
    expect(petWindow).toContain('setAlwaysOnTop(settings.alwaysOnTop, "screen-saver", 1)');
    expect(mergeSettings).toContain('setAlwaysOnTop(settings.alwaysOnTop, "screen-saver", 1)');
    expect(mainSource).toContain('from "./native-window-bridge"');
    expect(mainSource).toContain("petWindowLogicalBounds");
    expect(petWindow).toContain("nativeWindowBridge.setAlwaysOnTop");
    expect(mergeSettings).toContain("nativeWindowBridge.setAlwaysOnTop");
    expect(pointerTracking).toContain("currentPetWindowBounds()");
    expect(dragHandlers).toContain("currentPetWindowBounds()");
    expect(dragHandlers).toContain("petMovementBounds(display.bounds, display.workArea)");
    expect(dragHandlers).toContain("petWindowPositionForCenter(center, currentBounds, movementBounds)");
    expect(dragHandlers).toContain("movePetWindow(win, nativeWindowBridge, currentBounds, position)");
    expect(dragHandlers).toContain("petOffsetForCenter(center, petWindowLogicalBounds, movementBounds, settings.characterSize)");
  });
});
