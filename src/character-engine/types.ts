export const GROK_STATES = [
  "sleeping", "waking", "idle", "listening", "thinking", "searching", "working",
  "excited", "surprised", "suspicious", "angry", "drowsy", "happy", "curious",
  "confused", "bored", "proud", "shy", "sad", "laughing", "scared", "playful",
  "celebrate", "orbit", "radar", "progress", "spawning", "humming", "loading",
  "dictating", "writing", "sending", "receiving", "uploading", "notifying",
  "alerting", "dragging", "bouncing", "powering-down"
] as const;

export const GROK_SHAPES = [
  "blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder",
  "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud",
  "teardrop", "leaf"
] as const;

export type GrokState = typeof GROK_STATES[number];
export type GrokShape = typeof GROK_SHAPES[number];
export type GrokOneShot = "bounce" | "spin" | "burst" | "wild-spin";
export type StatusColorRole = "completed" | "error" | "stopped" | "waiting";

export interface CharacterDirective {
  state: GrokState;
  shape: GrokShape;
  emphasis: boolean;
  priority: number;
  expiresAt?: number;
  oneShot?: GrokOneShot;
  statusColorRole?: StatusColorRole;
}

export interface GrokCharacterInstance {
  state: GrokState;
  shapeName: GrokShape;
  reduceMotion: boolean;
  setMode(mode: "hold" | "onboarding"): void;
  setState(state: GrokState, options?: { resetEyes?: boolean }): void;
  setShape(shape: GrokShape): void;
  setColor(color: string, scheme?: "light" | "dark"): void;
  setInk(color: string | null): void;
  setEyeColor(color: string | null): void;
  setPaused(paused: boolean): void;
  setEmphasis(emphasis: boolean): void;
  setFollowPointer(enabled: boolean): void;
  setGazeTarget(point: { x: number; y: number } | null): void;
  spinOnce(turns?: number): void;
  bounceOnce(): void;
  burstOnce(): void;
  destroy(): void;
}

export interface GrokCharacterConstructor {
  new(svg: SVGSVGElement, options?: Record<string, unknown>): GrokCharacterInstance;
}

declare global {
  interface Window {
    GrokCharacter?: GrokCharacterConstructor;
    GROK_GEO?: { shapes: Record<GrokShape, unknown>; eyes: unknown[] };
    GROK_META?: { groups: Array<{ label: string; states: GrokState[] }>; overlays: Record<string, string> };
  }
}
