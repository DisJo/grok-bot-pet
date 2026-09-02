import { describe, expect, it } from "vitest";
import * as windowSizing from "./pet-window";

type BoundsFn = (
  workArea: { x: number; y: number; width: number; height: number },
  tray: { x: number; y: number; width: number; height: number },
  menuAtTop: boolean
) => { x: number; y: number; width: number; height: number };

const settingsWindowBounds = (windowSizing as unknown as { settingsWindowBounds?: BoundsFn }).settingsWindowBounds;

describe("settings window placement", () => {
  it("uses the full preferred height when the display has room", () => {
    expect(settingsWindowBounds).toBeTypeOf("function");
    if (!settingsWindowBounds) return;
    expect(settingsWindowBounds(
      { x: 0, y: 25, width: 1440, height: 875 },
      { x: 1000, y: 0, width: 24, height: 24 },
      true
    )).toEqual({ x: 817, y: 33, width: 390, height: 720 });
  });

  it("shrinks to the available height instead of clipping menu content", () => {
    expect(settingsWindowBounds).toBeTypeOf("function");
    if (!settingsWindowBounds) return;
    const bounds = settingsWindowBounds(
      { x: 0, y: 25, width: 800, height: 575 },
      { x: 700, y: 0, width: 24, height: 24 },
      true
    );
    expect(bounds).toEqual({ x: 402, y: 33, width: 390, height: 559 });
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(592);
  });
});
