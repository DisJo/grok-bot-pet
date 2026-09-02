const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const projectRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
let settings = {
  settingsVersion: 5,
  launchAtLogin: true,
  alwaysOnTop: true,
  opacity: 1,
  activeOnly: false,
  pointerFollowing: true,
  showBadge: true,
  shadowsEnabled: true,
  characterSize: 196,
  bodyColor: "black",
  eyeColor: "#ffffff",
  autoShape: false,
  fixedShape: "blob",
  clickInteractions: true,
  statusColorsEnabled: true,
  statusColors: { completed: "green", error: "red", stopped: "gray", waiting: "yellow" }
};

function fail(message) {
  process.stderr.write(`Settings toggle smoke test failed: ${message}\n`);
  app.exit(1);
}

ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:set", (event, patch) => {
  settings = { ...settings, ...patch, statusColors: { ...settings.statusColors, ...(patch.statusColors || {}) } };
  event.sender.send("settings:changed", settings);
  return settings;
});
ipcMain.handle("settings:preview", () => settings);
ipcMain.handle("codex:getOverview", () => ({ connected: false, activeCount: 0, hasWaiting: false, recentTasks: [] }));
ipcMain.handle("codex:refresh", () => ({ connected: false, activeCount: 0, hasWaiting: false, recentTasks: [] }));
ipcMain.handle("pet:isVisible", () => true);
ipcMain.handle("app:getVersion", () => "0.1.5");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 390,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(projectRoot, "dist-electron/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ["--app-locale=zh"]
    }
  });
  await window.loadFile(path.join(projectRoot, "dist/index.html"), { query: { view: "settings" } });

  const result = await window.webContents.executeJavaScript(`(async () => {
    const scroll = document.querySelector(".settings-scroll");
    const animationToggle = [...document.querySelectorAll(".toggle-row")].find((element) => element.textContent.includes("启用动画"));
    const toggle = [...document.querySelectorAll(".toggle-row")].find((element) => element.textContent.includes("显示投影与阴影"));
    if (animationToggle) return { error: "animation toggle is still visible" };
    if (!scroll || !toggle) return { error: "missing scroll container or shadow toggle" };
    toggle.scrollIntoView({ block: "center" });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const before = scroll.scrollTop;
    toggle.focus();
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      tagName: toggle.tagName,
      role: toggle.getAttribute("role"),
      checked: toggle.getAttribute("aria-checked"),
      before,
      after: scroll.scrollTop
    };
  })()`);

  if (result.error) return fail(result.error);
  if (result.tagName !== "BUTTON" || result.role !== "switch") return fail(`unexpected control ${JSON.stringify(result)}`);
  if (result.checked !== "false") return fail(`switch did not change: ${JSON.stringify(result)}`);
  if (Math.abs(result.after - result.before) > 1) return fail(`scroll position moved: ${JSON.stringify(result)}`);

  process.stdout.write(`Settings toggle smoke test passed: scrollTop ${result.before} -> ${result.after}, shadows ${result.checked}\n`);
  window.destroy();
  app.quit();
}).catch((error) => fail(error instanceof Error ? error.stack || error.message : String(error)));
