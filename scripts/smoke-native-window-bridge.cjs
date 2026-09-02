const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const appPath = path.resolve(process.argv[2] || path.join(__dirname, "../release/mac-universal/Grok Bot Pet.app"));
const modulePath = path.join(appPath, "Contents", "Resources", "native", "window-bridge.node");
const binding = require(modulePath);

function fail(message) {
  process.stderr.write(`Native window bridge smoke test failed: ${message}\n`);
  app.exit(1);
}

app.whenReady().then(() => {
  app.setActivationPolicy("accessory");
  app.dock?.hide();
  const window = new BrowserWindow({
    width: 872,
    height: 872,
    x: 220,
    y: 220,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: "#00000000"
  });
  window.setAlwaysOnTop(true, "screen-saver", 1);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  window.setFullScreenable(false);
  window.setIgnoreMouseEvents(true, { forward: true });
  window.showInactive();
  const handle = window.getNativeWindowHandle();
  if (binding.setAlwaysOnTop(handle, true) !== true) return fail("setAlwaysOnTop returned false");

  const target = { x: 237, y: 0 };
  window.setPosition(target.x, target.y, false);
  const reported = window.getBounds();
  const before = binding.getWindowFrame(handle);
  if (!before) return fail("getWindowFrame returned no frame after Electron placement");
  const electronDeltaX = target.x - before.x;
  const electronDeltaY = target.y - before.y;
  if (binding.offsetWindow(handle, electronDeltaX, electronDeltaY) !== true) return fail("offsetWindow returned false");
  const after = binding.getWindowFrame(handle);
  if (!after) return fail("getWindowFrame returned no moved frame");

  if (Math.abs(after.x - target.x) > 0.5 || Math.abs(after.y - target.y) > 0.5) {
    return fail(`Electron reported (${reported.x}, ${reported.y}), native frame started at (${before.x}, ${before.y}), expected final (${target.x}, ${target.y}), got (${after.x}, ${after.y})`);
  }

  process.stdout.write(`Native window bridge smoke test passed: Electron reported y=${reported.y}, native y=${before.y}, corrected y=${after.y}\n`);
  window.destroy();
  app.quit();
}).catch((error) => fail(error instanceof Error ? error.stack || error.message : String(error)));
