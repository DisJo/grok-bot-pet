import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const exposed: Record<string, unknown> = {};
const invoke = vi.fn(async (channel: string) => channel);
const send = vi.fn();
const originalArgv = [...process.argv];

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed[name] = value; } },
  ipcRenderer: {
    invoke,
    send,
    on: vi.fn(),
    removeListener: vi.fn()
  }
}));

describe("preload app version API", () => {
  beforeAll(() => { process.argv.push("--app-locale=zh"); });
  afterAll(() => { process.argv.splice(0, process.argv.length, ...originalArgv); });
  beforeEach(() => { invoke.mockClear(); send.mockClear(); });

  it("asks the main process for the packaged app version", async () => {
    await import("./preload");
    const api = exposed.pet as { getAppVersion?: () => Promise<string> };
    expect(api.getAppVersion).toBeTypeOf("function");
    await expect(api.getAppVersion!()).resolves.toBe("app:getVersion");
    expect(invoke).toHaveBeenCalledWith("app:getVersion");
  });

  it("does not expose an asynchronous locale request beside the synchronous startup locale", async () => {
    await import("./preload");
    const api = exposed.pet as { getAppLocale?: () => Promise<string> };
    expect(api.getAppLocale).toBeUndefined();
  });

  it("exposes the main-resolved locale synchronously for the first render", async () => {
    await import("./preload");
    const api = exposed.pet as { appLocale?: string };
    expect(api.appLocale).toBe("zh");
  });

  it("forwards pointer coordinates with drag events", async () => {
    await import("./preload");
    const api = exposed.pet as {
      beginDrag?: (point: { x: number; y: number }) => Promise<void>;
      dragTo?: (point: { x: number; y: number }) => Promise<void>;
    };
    const start = { x: 120, y: 240 };
    const move = { x: 180, y: 300 };
    await api.beginDrag!(start);
    await api.dragTo!(move);
    expect(send).toHaveBeenNthCalledWith(1, "window:beginDrag", start);
    expect(send).toHaveBeenNthCalledWith(2, "window:dragTo", move);
  });
});
