import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { CharacterDirective, GrokCharacterInstance, GrokOneShot, StatusColorRole } from "./types";

export interface GrokCharacterHandle {
  play(oneShot: GrokOneShot): void;
}

interface Props {
  directive: CharacterDirective;
  pointerFollowing: boolean;
  gaze: { x: number; y: number };
  size: number;
  bodyColor: "black" | "gray" | "brown" | "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "violet" | "magenta";
  baseBodyColor: "black" | "gray" | "brown" | "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "violet" | "magenta";
  eyeColor: string;
}

export const BODY_INK = { black: "#000000", gray: "#777777", brown: "#855c36", red: "#e02135", orange: "#ff6700", yellow: "#ffd60a", green: "#009957", cyan: "#00a592", blue: "#0e74e0", violet: "#804ee0", magenta: "#e02a88" } as const;

export function prefersReducedMotion(matchMedia: (query: string) => { matches: boolean } = window.matchMedia.bind(window)) {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const GrokCharacter = forwardRef<GrokCharacterHandle, Props>(function GrokCharacter(
  { directive, pointerFollowing, gaze, size, bodyColor, baseBodyColor, eyeColor }, ref
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<GrokCharacterInstance | undefined>(undefined);
  const lastOneShot = useRef<string | undefined>(undefined);
  const colorAnimation = useRef<number | undefined>(undefined);
  const currentInk = useRef<string>(BODY_INK[bodyColor]);

  useEffect(() => {
    if (!svgRef.current || !window.GrokCharacter) return;
    const engine = new window.GrokCharacter(svgRef.current, {
      mode: "hold",
      state: directive.state,
      shape: directive.shape,
      color: bodyColor,
      scheme: "light",
      loginWrap: true,
      followPointer: false,
      eyeColor,
      inkFlat: BODY_INK[bodyColor],
      reduceMotion: prefersReducedMotion(),
      paused: false
    });
    engine.setMode("hold");
    engine.setInk(BODY_INK[bodyColor]);
    engine.setEyeColor(eyeColor);
    currentInk.current = BODY_INK[bodyColor];
    engineRef.current = engine;
    return () => {
      if (colorAnimation.current !== undefined) cancelAnimationFrame(colorAnimation.current);
      engine.destroy();
      engineRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setColor(bodyColor, "light");
    engine.setEyeColor(eyeColor);
    if (colorAnimation.current !== undefined) cancelAnimationFrame(colorAnimation.current);
    const from = currentInk.current;
    const to = BODY_INK[bodyColor];
    const base = BODY_INK[baseBodyColor];
    const reduceMotion = prefersReducedMotion();
    const statusBehavior = statusColorBehavior(directive.statusColorRole);
    const pulse = statusBehavior === "breathe" && to !== base;
    if (pulse && !reduceMotion) {
      const startedAt = performance.now();
      const initialColor = statusPulseInk(0, to, base, false);
      engine.setInk(initialColor);
      currentInk.current = initialColor;
      const tick = (now: number) => {
        const color = statusPulseInk(now - startedAt, to, base, false);
        if (color !== currentInk.current) {
          engine.setInk(color);
          currentInk.current = color;
        }
        colorAnimation.current = requestAnimationFrame(tick);
      };
      colorAnimation.current = requestAnimationFrame(tick);
      return () => {
        if (colorAnimation.current !== undefined) cancelAnimationFrame(colorAnimation.current);
        colorAnimation.current = undefined;
      };
    }
    if (reduceMotion || from === to) {
      engine.setInk(to);
      currentInk.current = to;
      return;
    }
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 260);
      const eased = 1 - Math.pow(1 - progress, 3);
      const color = interpolateHex(from, to, eased);
      engine.setInk(color);
      currentInk.current = color;
      if (progress < 1) colorAnimation.current = requestAnimationFrame(tick);
      else {
        colorAnimation.current = undefined;
      }
    };
    colorAnimation.current = requestAnimationFrame(tick);
    return () => {
      if (colorAnimation.current !== undefined) cancelAnimationFrame(colorAnimation.current);
      colorAnimation.current = undefined;
    };
  }, [baseBodyColor, bodyColor, directive.statusColorRole, eyeColor]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.reduceMotion = prefersReducedMotion();
    engine.setEmphasis(directive.emphasis);
    if (engine.shapeName !== directive.shape) engine.setShape(directive.shape);
    if (engine.state !== directive.state) engine.setState(directive.state);
    const oneShotKey = directive.oneShot ? `${directive.state}:${directive.oneShot}:${directive.expiresAt ?? 0}` : undefined;
    if (directive.oneShot && oneShotKey !== lastOneShot.current) play(engine, directive.oneShot);
    lastOneShot.current = oneShotKey;
  }, [directive]);

  useEffect(() => {
    const engine = engineRef.current;
    const svg = svgRef.current;
    if (!engine || !svg) return;
    const follows = pointerFollowing && ["idle", "curious", "bored", "happy", "playful", "proud", "shy", "drowsy"].includes(directive.state);
    if (!follows) return engine.setGazeTarget(null);
    const rect = svg.getBoundingClientRect();
    engine.setGazeTarget({
      x: rect.left + rect.width / 2 + gaze.x * rect.width,
      y: rect.top + rect.height / 2 + gaze.y * rect.height
    });
  }, [directive.state, gaze, pointerFollowing]);

  useImperativeHandle(ref, () => ({ play(oneShot) { const engine = engineRef.current; if (engine) play(engine, oneShot); } }), []);

  const renderedSize = Math.min(320, Math.max(64, size));
  return <svg ref={svgRef} className="grok-character" style={{ width: renderedSize, height: renderedSize }} role="img" aria-label={`Grok Bot：${directive.state}`} />;
});

function play(engine: GrokCharacterInstance, oneShot: GrokOneShot) {
  if (oneShot === "bounce") engine.bounceOnce();
  else if (oneShot === "spin") engine.spinOnce(1);
  else if (oneShot === "burst") engine.burstOnce();
  else { engine.spinOnce(4); engine.burstOnce(); }
}

export function statusPulseInk(elapsed: number, statusInk: string, baseInk: string, reduceMotion: boolean) {
  if (reduceMotion) return statusInk;
  const phase = elapsed % 2400;
  const intensity = Math.round((1 - Math.cos((phase / 2400) * Math.PI * 2)) * 500_000) / 1_000_000;
  return interpolateHex(baseInk, statusInk, intensity);
}

export function statusColorBehavior(role: StatusColorRole | undefined): "breathe" | undefined {
  if (role) return "breathe";
  return undefined;
}

function interpolateHex(from: string, to: string, amount: number) {
  const a = hexChannels(from);
  const b = hexChannels(to);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function hexChannels(color: string) {
  const hex = color.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}
