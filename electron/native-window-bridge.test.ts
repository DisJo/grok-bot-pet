import { describe, expect, it } from "vitest";
import { NativeWindowBridge, type NativeWindowBinding } from "./native-window-bridge";

const handle = Buffer.from("0000000000000000", "hex");

function binding(overrides: Partial<NativeWindowBinding> = {}): NativeWindowBinding {
  return {
    offsetWindow: () => true,
    setAlwaysOnTop: () => true,
    getWindowFrame: () => ({ x: 1, y: 2, width: 300, height: 300 }),
    ...overrides
  };
}

describe("native macOS window bridge adapter", () => {
  it("loads once and forwards valid calls", () => {
    const calls: unknown[][] = [];
    let loads = 0;
    const bridge = new NativeWindowBridge("bridge.node", () => {
      loads += 1;
      return binding({
        offsetWindow: (...args) => { calls.push(args); return true; },
        setAlwaysOnTop: (...args) => { calls.push(args); return true; }
      });
    });
    expect(bridge.offsetWindow(handle, -12, 25)).toBe(true);
    expect(bridge.setAlwaysOnTop(handle, true)).toBe(true);
    expect(bridge.getWindowFrame(handle)).toEqual({ x: 1, y: 2, width: 300, height: 300 });
    expect(loads).toBe(1);
    expect(calls).toEqual([[handle, -12, 25], [handle, true]]);
  });

  it("falls back safely when the module cannot load", () => {
    const bridge = new NativeWindowBridge("missing.node", () => { throw new Error("missing"); });
    expect(bridge.offsetWindow(handle, 1, 2)).toBe(false);
    expect(bridge.setAlwaysOnTop(handle, true)).toBe(false);
    expect(bridge.getWindowFrame(handle)).toBeUndefined();
  });

  it("contains native exceptions and rejects malformed bindings", () => {
    const throwing = new NativeWindowBridge("bridge.node", () => binding({
      offsetWindow: () => { throw new Error("native failure"); },
      setAlwaysOnTop: () => { throw new Error("native failure"); },
      getWindowFrame: () => { throw new Error("native failure"); }
    }));
    expect(throwing.offsetWindow(handle, 1, 2)).toBe(false);
    expect(throwing.setAlwaysOnTop(handle, true)).toBe(false);
    expect(throwing.getWindowFrame(handle)).toBeUndefined();

    const malformed = new NativeWindowBridge("bridge.node", () => ({ offsetWindow: true }));
    expect(malformed.offsetWindow(handle, 1, 2)).toBe(false);
  });

  it("rejects invalid arguments and non-finite frames without calling native code", () => {
    let calls = 0;
    const bridge = new NativeWindowBridge("bridge.node", () => binding({
      offsetWindow: () => { calls += 1; return true; },
      getWindowFrame: () => ({ x: Number.NaN, y: 2, width: 300, height: 300 })
    }));
    expect(bridge.offsetWindow(handle, Number.NaN, 2)).toBe(false);
    expect(bridge.offsetWindow(Buffer.alloc(0), 1, 2)).toBe(false);
    expect(bridge.getWindowFrame(handle)).toBeUndefined();
    expect(calls).toBe(0);
  });
});
