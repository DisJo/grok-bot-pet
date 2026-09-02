import { describe, expect, it } from "vitest";
import * as petWindow from "./pet-window";

const { petWindowSize } = petWindow;
const dragHelpers = petWindow as typeof petWindow & {
  isFinitePoint?: (point: { x: number; y: number }) => boolean;
  petWindowPositionForCenter?: (
    center: { x: number; y: number },
    windowBounds: { x: number; y: number; width: number; height: number },
    workArea: { x: number; y: number; width: number; height: number }
  ) => { x: number; y: number };
  petOffsetForCenter?: (
    center: { x: number; y: number },
    actualWindowBounds: { x: number; y: number; width: number; height: number },
    workArea: { x: number; y: number; width: number; height: number },
    characterSize: number
  ) => { x: number; y: number };
  petMovementBounds?: (
    displayBounds: { x: number; y: number; width: number; height: number },
    workArea: { x: number; y: number; width: number; height: number }
  ) => { x: number; y: number; width: number; height: number };
  petHitTargetContains?: (
    pointer: { x: number; y: number },
    windowBounds: { x: number; y: number; width: number; height: number },
    offset: { x: number; y: number },
    characterSize: number
  ) => boolean;
  movePetWindow?: (
    window: {
      getBounds(): { x: number; y: number; width: number; height: number };
      setPosition(x: number, y: number, animate?: boolean): void;
      getNativeWindowHandle(): Buffer;
    },
    nativeBridge: { offsetWindow(nativeHandle: Buffer, dx: number, dy: number): boolean },
    logicalBounds: { x: number; y: number; width: number; height: number },
    targetPosition: { x: number; y: number }
  ) => { x: number; y: number; width: number; height: number };
};

describe("pet window sizing", () => {
  it("adds enough native-window overscan for every visual effect", () => {
    expect(petWindowSize(64)).toBe(190);
    expect(petWindowSize(12)).toBe(190);
    expect(petWindowSize(250)).toBe(686);
    expect(petWindowSize(270)).toBe(740);
    expect(petWindowSize(999)).toBe(872);
  });

  it("matches the renderer's particle, ribbon and shadow safety margins", () => {
    const expected = [[64, 63], [250, 218], [270, 235], [320, 276]] as const;
    for (const [characterSize, margin] of expected) {
      expect(petWindowSize(characterSize)).toBe(characterSize + margin * 2);
    }
  });

});

describe("pet dragging", () => {
  it("finds the visible character from the global pointer without relying on window mouse events", () => {
    expect(dragHelpers.petHitTargetContains).toBeTypeOf("function");
    const bounds = { x: 100, y: 200, width: 872, height: 872 };
    const offset = { x: -120, y: 48 };
    expect(dragHelpers.petHitTargetContains?.({ x: 416, y: 684 }, bounds, offset, 196)).toBe(true);
    expect(dragHelpers.petHitTargetContains?.({ x: 318, y: 586 }, bounds, offset, 196)).toBe(true);
    expect(dragHelpers.petHitTargetContains?.({ x: 317, y: 586 }, bounds, offset, 196)).toBe(false);
    expect(dragHelpers.petHitTargetContains?.({ x: 416, y: 783 }, bounds, offset, 196)).toBe(false);
  });

  it("uses the full display including the menu bar and Dock areas", () => {
    expect(dragHelpers.petMovementBounds).toBeTypeOf("function");
    const display = { x: 0, y: 0, width: 1316, height: 1382 };
    expect(dragHelpers.petMovementBounds?.(
      display,
      { x: 0, y: 25, width: 1316, height: 1182 }
    )).toEqual(display);
    expect(dragHelpers.petMovementBounds?.(
      display,
      { x: 90, y: 25, width: 1226, height: 1357 }
    )).toEqual(display);
    expect(dragHelpers.petMovementBounds?.(
      display,
      { x: 0, y: 25, width: 1226, height: 1357 }
    )).toEqual(display);
  });

  it("rejects non-finite coordinates before calling Electron window APIs", () => {
    expect(dragHelpers.isFinitePoint).toBeTypeOf("function");
    expect(dragHelpers.isFinitePoint?.({ x: 240, y: 80 })).toBe(true);
    expect(dragHelpers.isFinitePoint?.({ x: Number.NaN, y: 80 })).toBe(false);
    expect(dragHelpers.isFinitePoint?.({ x: 240, y: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("keeps an oversized effect window at a valid display coordinate", () => {
    expect(dragHelpers.petWindowPositionForCenter).toBeTypeOf("function");
    expect(dragHelpers.petWindowPositionForCenter?.(
      { x: 720, y: 40 },
      { x: 284, y: 25, width: 872, height: 872 },
      { x: 0, y: 25, width: 1440, height: 775 }
    )).toEqual({ x: 284, y: 25 });
  });

  it("lets the character move beyond the screen top while keeping a grab handle visible", () => {
    expect(dragHelpers.petOffsetForCenter).toBeTypeOf("function");
    const windowBounds = { x: 284, y: 25, width: 872, height: 872 };
    const offset = dragHelpers.petOffsetForCenter?.(
      { x: 720, y: -1000 },
      windowBounds,
      { x: 0, y: 25, width: 1440, height: 775 },
      320
    );
    expect(offset).toEqual({ x: 0, y: -564 });
    const visualTop = windowBounds.y + windowBounds.height / 2 + (offset?.y ?? 0) - 160;
    const visualBottom = visualTop + 320;
    expect(visualTop).toBe(-263);
    expect(visualBottom - 25).toBe(32);
  });

  it("corrects Electron's menu-bar clamp and preserves the requested logical bounds", () => {
    expect(dragHelpers.movePetWindow).toBeTypeOf("function");
    const handle = Buffer.from("0000000000000000", "hex");
    const corrections: unknown[][] = [];
    let reported = { x: 284, y: 25, width: 872, height: 872 };
    const window = {
      getBounds: () => reported,
      setPosition: (x: number, y: number, animate?: boolean) => {
        expect({ x, y, animate }).toEqual({ x: 284, y: 0, animate: false });
        reported = { ...reported, x, y: Math.max(25, y) };
      },
      getNativeWindowHandle: () => handle
    };
    const nativeBridge = {
      offsetWindow: (...args: unknown[]) => { corrections.push(args); return true; }
    };

    expect(dragHelpers.movePetWindow?.(
      window,
      nativeBridge,
      { x: 284, y: 25, width: 872, height: 872 },
      { x: 284, y: 0 }
    )).toEqual({ x: 284, y: 0, width: 872, height: 872 });
    expect(corrections).toEqual([[handle, 0, -25]]);
  });

  it("uses the native frame when Electron reports the requested position instead of the clamped position", () => {
    expect(dragHelpers.movePetWindow).toBeTypeOf("function");
    const handle = Buffer.from("0000000000000000", "hex");
    const corrections: unknown[][] = [];
    const window = {
      getBounds: () => ({ x: 284, y: 0, width: 872, height: 872 }),
      setPosition: () => {},
      getNativeWindowHandle: () => handle
    };
    const nativeBridge = {
      getWindowFrame: () => ({ x: 284, y: 30, width: 872, height: 872 }),
      offsetWindow: (...args: unknown[]) => { corrections.push(args); return true; }
    };

    expect(dragHelpers.movePetWindow?.(
      window,
      nativeBridge,
      { x: 284, y: 30, width: 872, height: 872 },
      { x: 284, y: 0 }
    )).toEqual({ x: 284, y: 0, width: 872, height: 872 });
    expect(corrections).toEqual([[handle, 0, -30]]);
  });

  it("falls back to Electron-reported bounds when native correction fails", () => {
    expect(dragHelpers.movePetWindow).toBeTypeOf("function");
    const handle = Buffer.from("0000000000000000", "hex");
    let reported = { x: -720, y: 25, width: 740, height: 740 };
    const window = {
      getBounds: () => reported,
      setPosition: (x: number, y: number) => { reported = { ...reported, x, y: Math.max(25, y) }; },
      getNativeWindowHandle: () => handle
    };

    expect(dragHelpers.movePetWindow?.(
      window,
      { offsetWindow: () => false },
      { x: -720, y: 25, width: 740, height: 740 },
      { x: -980, y: -40 }
    )).toEqual({ x: -980, y: 25, width: 740, height: 740 });
  });

  it("does not send invalid coordinates to Electron or native code", () => {
    expect(dragHelpers.movePetWindow).toBeTypeOf("function");
    let electronCalls = 0;
    let nativeCalls = 0;
    const logical = { x: -1600, y: 0, width: 740, height: 740 };
    const window = {
      getBounds: () => ({ x: -1600, y: 25, width: 740, height: 740 }),
      setPosition: () => { electronCalls += 1; },
      getNativeWindowHandle: () => Buffer.alloc(8)
    };

    expect(dragHelpers.movePetWindow?.(
      window,
      { offsetWindow: () => { nativeCalls += 1; return true; } },
      logical,
      { x: Number.NEGATIVE_INFINITY, y: Number.NaN }
    )).toEqual(logical);
    expect(electronCalls).toBe(0);
    expect(nativeCalls).toBe(0);
  });
});
