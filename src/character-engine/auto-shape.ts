import { GROK_SHAPES, GrokShape } from "./types";

const SHAPE_SLOT_MS = 5_000;

const shuffledShapes = (round: number): GrokShape[] => {
  const shapes = [...GROK_SHAPES];
  let seed = round + 1;

  for (let index = shapes.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const swapIndex = Math.floor((seed / 0x1_0000_0000) * (index + 1));
    [shapes[index], shapes[swapIndex]] = [shapes[swapIndex], shapes[index]];
  }

  return shapes;
};

export const uniformAutoShape = (elapsedMs: number): GrokShape => {
  const slot = Math.floor(elapsedMs / SHAPE_SLOT_MS);
  const round = Math.floor(slot / GROK_SHAPES.length);
  return shuffledShapes(round)[slot % GROK_SHAPES.length];
};
