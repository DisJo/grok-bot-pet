import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, screen, MenuItemConstructorOptions } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { CodexBridge } from "./codex-bridge";
import { CodexOverview, PetSettings } from "./types";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";
import { EMPTY_CODEX_OVERVIEW } from "./defaults";
import { isFinitePoint, movePetWindow, petHitTargetContains, petMovementBounds, petOffsetForCenter, petWindowPositionForCenter, petWindowSize, settingsWindowBounds, type PetBounds, type PetPoint } from "./pet-window";
import { AppLocale, localizedCopy, resolveAppLocale } from "./localization";
import { NativeWindowBridge } from "./native-window-bridge";

let win: BrowserWindow | undefined;
let settingsWin: BrowserWindow | undefined;
let tray: Tray | undefined;
let trayMenu: Menu | undefined;
let bridge: CodexBridge;
let settings: PetSettings = DEFAULT_SETTINGS;
let lastOverview: CodexOverview = EMPTY_CODEX_OVERVIEW;
let trayMenuSignature = "";
let dragState: { pointerX: number; pointerY: number; centerX: number; centerY: number } | undefined;
let petOffset = { x: 0, y: 0 };
let petWindowLogicalBounds: PetBounds | undefined;
let pointerTimer: NodeJS.Timeout | undefined;
let petHitTargetActive = false;
let lastPointerDirection = { x: 0, y: 0 };
let appLocale: AppLocale = "en";
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const nativeWindowBridge = new NativeWindowBridge(app.isPackaged
  ? path.join(process.resourcesPath, "native/window-bridge.node")
  : path.join(app.getAppPath(), "build/native/window-bridge.node"));

async function loadSettings() {
  try {
    const stored = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
    const needsMigration = (stored.settingsVersion ?? 1) < 5;
    settings = normalizeSettings(stored);
    if (needsMigration) await saveSettings();
  } catch {}
}
async function saveSettings() { await fs.mkdir(path.dirname(settingsPath()), { recursive: true }); await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2)); }
function mergeSettings(patch: Partial<PetSettings>) {
  settings = normalizeSettings({ ...settings, ...patch, statusColors: { ...settings.statusColors, ...(patch.statusColors || {}) } });
  if (patch.alwaysOnTop !== undefined && win) {
    win.setAlwaysOnTop(settings.alwaysOnTop, "screen-saver", 1);
    try { nativeWindowBridge.setAlwaysOnTop(win.getNativeWindowHandle(), settings.alwaysOnTop); } catch {}
  }
  if (patch.opacity !== undefined) win?.setOpacity(settings.opacity);
  if (patch.launchAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  win?.webContents.send("settings:changed", settings);
  settingsWin?.webContents.send("settings:changed", settings);
  rebuildTrayMenu();
}
async function applySettings(patch: Partial<PetSettings>) {
  mergeSettings(patch);
  await saveSettings();
  return settings;
}
function previewSettings(patch: Partial<PetSettings>) {
  settings = normalizeSettings({ ...settings, ...patch, statusColors: { ...settings.statusColors, ...(patch.statusColors || {}) } });
  if (patch.opacity !== undefined) win?.setOpacity(settings.opacity);
  win?.webContents.send("settings:changed", settings);
  return settings;
}

function createWindow() {
  const windowSize = petWindowSize(320);
  win = new BrowserWindow({ width: windowSize, height: windowSize, transparent: true, frame: false, resizable: false, alwaysOnTop: settings.alwaysOnTop, hasShadow: false, show: false, backgroundColor: "#00000000", webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, additionalArguments: [`--app-locale=${appLocale}`] } });
  win.setAlwaysOnTop(settings.alwaysOnTop, "screen-saver", 1);
  try { nativeWindowBridge.setAlwaysOnTop(win.getNativeWindowHandle(), settings.alwaysOnTop); } catch {}
  petWindowLogicalBounds = win.getBounds();
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setFullScreenable(false);
  win.setSkipTaskbar(true);
  petHitTargetActive = false;
  win.setIgnoreMouseEvents(true, { forward: true });
  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  void win.loadURL(app.isPackaged ? `file://${path.join(__dirname, "../dist/index.html")}` : devUrl);
  win.once("ready-to-show", () => win?.showInactive());
  win.on("closed", () => { win = undefined; petWindowLogicalBounds = undefined; petHitTargetActive = false; });
}

function currentPetWindowBounds() {
  if (!win) return undefined;
  const reported = win.getBounds();
  return petWindowLogicalBounds
    ? { ...reported, x: petWindowLogicalBounds.x, y: petWindowLogicalBounds.y }
    : reported;
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin;
  settingsWin = new BrowserWindow({
    width: 390,
    height: 720,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    type: "panel",
    backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, additionalArguments: [`--app-locale=${appLocale}`] }
  });
  settingsWin.setHasShadow(false);
  settingsWin.setAlwaysOnTop(true, "screen-saver", 2);
  settingsWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  void settingsWin.loadURL(app.isPackaged ? `file://${path.join(__dirname, "../dist/index.html")}?view=settings` : `${devUrl}/?view=settings`);
  settingsWin.on("blur", () => settingsWin?.hide());
  settingsWin.on("hide", rebuildTrayMenu);
  settingsWin.on("closed", () => { settingsWin = undefined; rebuildTrayMenu(); });
  return settingsWin;
}

function positionSettingsWindow() {
  if (!tray || !settingsWin) return;
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const menuAtTop = trayBounds.y < display.bounds.y + display.bounds.height / 2;
  settingsWin.setBounds(settingsWindowBounds(display.workArea, trayBounds, menuAtTop), false);
}

function showSettingsPanel() {
  const panel = createSettingsWindow();
  const show = () => { positionSettingsWindow(); panel.show(); panel.moveTop(); panel.focus(); panel.webContents.send("settings:shown"); rebuildTrayMenu(); };
  if (panel.webContents.isLoading()) panel.once("ready-to-show", show); else show();
}

function toggleSettingsPanel() {
  if (settingsWin?.isVisible()) settingsWin.hide(); else showSettingsPanel();
}

function setPetHitTarget(active: boolean) {
  if (!win || win.isDestroyed() || petHitTargetActive === active) return;
  petHitTargetActive = active;
  win.setIgnoreMouseEvents(!active, { forward: true });
}

function startPointerTracking() {
  if (pointerTimer) clearInterval(pointerTimer);
  pointerTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const bounds = currentPetWindowBounds();
    if (!bounds) return;
    const cursor = screen.getCursorScreenPoint();
    setPetHitTarget(Boolean(dragState) || petHitTargetContains(cursor, bounds, petOffset, settings.characterSize));
    const centerX = bounds.x + bounds.width / 2 + petOffset.x;
    const centerY = bounds.y + bounds.height / 2 + petOffset.y;
    const dx = cursor.x - centerX;
    const dy = cursor.y - centerY;
    const distance = Math.hypot(dx, dy);
    const strength = Math.min(1, distance / 180);
    const direction = distance < 1 ? { x: 0, y: 0 } : { x: dx / distance * strength, y: dy / distance * strength };
    if (Math.abs(direction.x - lastPointerDirection.x) < .015 && Math.abs(direction.y - lastPointerDirection.y) < .015) return;
    lastPointerDirection = direction;
    win.webContents.send("pointer:direction", direction);
  }, 50);
}

function createTray() {
  const trayLogoPath = app.isPackaged
    ? path.join(process.resourcesPath, "tray-logo.png")
    : path.join(app.getAppPath(), "build/tray-logo.png");
  const trayIcon = nativeImage.createFromPath(trayLogoPath).resize({ width: 20, height: 20, quality: "best" });
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip("Grok Bot Pet");
  tray.on("click", toggleSettingsPanel);
  tray.on("right-click", () => { if (trayMenu) tray?.popUpContextMenu(trayMenu); });
  rebuildTrayMenu();
}

function toggleWindow() { if (win?.isVisible()) win.hide(); else win?.showInactive(); rebuildTrayMenu(); return Boolean(win?.isVisible()); }

async function openCodexApp() {
  const candidates = ["/Applications/Codex.app", "/Applications/ChatGPT.app"];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const error = await shell.openPath(candidate);
    if (!error) return;
  }
  await shell.openExternal("codex://");
}

function rebuildTrayMenu() {
  if (!tray) return;
  const copy = localizedCopy(appLocale).tray;
  const signature = JSON.stringify({ locale: appLocale, connected: lastOverview.connected, activeCount: lastOverview.activeCount, selected: lastOverview.selectedTask?.threadId, settings, visible: win?.isVisible(), panel: settingsWin?.isVisible() });
  if (signature === trayMenuSignature) return;
  trayMenuSignature = signature;
  const selected = lastOverview.selectedTask;
  const statusLabel = lastOverview.connected
    ? lastOverview.activeCount > 0
      ? copy.working(lastOverview.activeCount, lastOverview.connectionMode === "local-inference")
      : lastOverview.connectionMode === "local-inference" ? copy.localIdle : copy.connectedIdle
    : copy.disconnected;
  const template: MenuItemConstructorOptions[] = [
    { label: statusLabel, enabled: false },
    ...(selected ? [{ label: copy.current(truncate(selected.title, 34)), enabled: false } as MenuItemConstructorOptions] : []),
    ...(!lastOverview.connected && lastOverview.lastError ? [{ label: copy.error(truncate(lastOverview.lastError, 44)), enabled: false } as MenuItemConstructorOptions] : []),
    { label: settingsWin?.isVisible() ? copy.closeSettings : copy.openSettings, click: toggleSettingsPanel },
    { label: win?.isVisible() ? copy.hidePet : copy.showPet, click: toggleWindow },
    { label: copy.refresh, click: () => void bridge?.refresh() },
    { label: copy.openCodex, click: () => void openCodexApp() },
    { type: "separator" },
    { label: copy.alwaysOnTop, type: "checkbox", checked: settings.alwaysOnTop, click: (item) => void applySettings({ alwaysOnTop: item.checked }) },
    { label: copy.shadows, type: "checkbox", checked: settings.shadowsEnabled, click: (item) => void applySettings({ shadowsEnabled: item.checked }) },
    { label: copy.pointerFollowing, type: "checkbox", checked: settings.pointerFollowing, click: (item) => void applySettings({ pointerFollowing: item.checked }) },
    { label: copy.launchAtLogin, type: "checkbox", checked: settings.launchAtLogin, click: (item) => void applySettings({ launchAtLogin: item.checked }) },
    { type: "separator" },
    { label: copy.version(app.getVersion()), enabled: false },
    { label: copy.quit, click: () => app.quit() }
  ];
  trayMenu = Menu.buildFromTemplate(template);
  tray.setToolTip(statusLabel);
}

function truncate(value: string, limit: number) { return value.length > limit ? `${value.slice(0, limit - 1)}…` : value; }

app.whenReady().then(async () => {
  app.setActivationPolicy("accessory");
  app.dock?.hide();
  appLocale = resolveAppLocale(app.getLocale());
  await loadSettings();
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  createWindow(); createTray(); startPointerTracking();
  bridge = new CodexBridge(undefined, localizedCopy(appLocale).data, {
    codexApprovalVisible: (promptForPermission) => nativeWindowBridge.codexApprovalVisible(promptForPermission)
  }); bridge.start();
  bridge.on("overview", (overview) => { lastOverview = overview; win?.webContents.send("codex:overview", overview); settingsWin?.webContents.send("codex:overview", overview); rebuildTrayMenu(); });
});

ipcMain.handle("codex:getOverview", () => bridge.overview());
ipcMain.handle("codex:refresh", () => bridge.refresh());
ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:set", async (_event, patch: Partial<PetSettings>) => applySettings(patch));
ipcMain.handle("settings:preview", (_event, patch: Partial<PetSettings>) => previewSettings(patch));
ipcMain.handle("pet:isVisible", () => Boolean(win?.isVisible()));
ipcMain.handle("pet:toggle", () => toggleWindow());
ipcMain.handle("settings:closePanel", () => settingsWin?.hide());
ipcMain.handle("app:getVersion", () => app.getVersion());
ipcMain.on("window:beginDrag", (_event, pointer: PetPoint) => {
  const bounds = currentPetWindowBounds();
  if (!bounds || !isFinitePoint(pointer)) return;
  dragState = {
    pointerX: pointer.x,
    pointerY: pointer.y,
    centerX: bounds.x + bounds.width / 2 + petOffset.x,
    centerY: bounds.y + bounds.height / 2 + petOffset.y
  };
  setPetHitTarget(true);
});
ipcMain.on("window:dragTo", (_event, pointer: PetPoint) => {
  if (!win || !dragState) return;
  if (!isFinitePoint(pointer)) return;
  const center = {
    x: dragState.centerX + pointer.x - dragState.pointerX,
    y: dragState.centerY + pointer.y - dragState.pointerY
  };
  if (!isFinitePoint(center)) return;
  const display = screen.getDisplayNearestPoint({ x: Math.round(center.x), y: Math.round(center.y) });
  const movementBounds = petMovementBounds(display.bounds, display.workArea);
  const currentBounds = currentPetWindowBounds();
  if (!currentBounds) return;
  const position = petWindowPositionForCenter(center, currentBounds, movementBounds);
  if (!isFinitePoint(position)) return;
  petWindowLogicalBounds = movePetWindow(win, nativeWindowBridge, currentBounds, position);
  petOffset = petOffsetForCenter(center, petWindowLogicalBounds, movementBounds, settings.characterSize);
  if (isFinitePoint(petOffset)) win.webContents.send("pet:windowOffset", petOffset);
});
ipcMain.on("window:endDrag", () => {
  dragState = undefined;
  const bounds = currentPetWindowBounds();
  if (bounds) setPetHitTarget(petHitTargetContains(screen.getCursorScreenPoint(), bounds, petOffset, settings.characterSize));
});
ipcMain.handle("codex:open", () => openCodexApp());
ipcMain.handle("app:quit", () => app.quit());
app.on("before-quit", () => { if (pointerTimer) clearInterval(pointerTimer); bridge?.stop(); settingsWin?.destroy(); });
app.on("window-all-closed", () => { /* Menu bar app stays alive until the user selects Quit. */ });
