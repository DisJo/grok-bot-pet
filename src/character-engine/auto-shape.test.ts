import { describe, expect, it } from "vitest";
import { uniformAutoShape } from "./auto-shape";
import { GROK_SHAPES } from "./types";

const SLOT_MS = 5_000;

describe("uniform auto shape", () => {
  it("shows every shape exactly once per round", () => {
    const round = GROK_SHAPES.map((_, index) => uniformAutoShape(index * SLOT_MS));

    expect(new Set(round)).toEqual(new Set(GROK_SHAPES));
    expect(round).toHaveLength(GROK_SHAPES.length);
  });

  it("keeps the shape stable within a five-second slot", () => {
    expect(uniformAutoShape(0)).toBe(uniformAutoShape(SLOT_MS - 1));
    expect(uniformAutoShape(SLOT_MS)).toBe(uniformAutoShape((2 * SLOT_MS) - 1));
  });

  it("uses a different complete order for the next round", () => {
    const firstRound = GROK_SHAPES.map((_, index) => uniformAutoShape(index * SLOT_MS));
    const secondRoundStart = GROK_SHAPES.length * SLOT_MS;
    const secondRound = GROK_SHAPES.map((_, index) => uniformAutoShape(secondRoundStart + (index * SLOT_MS)));

    expect(new Set(secondRound)).toEqual(new Set(GROK_SHAPES));
    expect(secondRound).not.toEqual(firstRound);
  });
});
