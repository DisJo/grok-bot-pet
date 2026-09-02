import { CSSProperties, PointerEvent, useEffect, useRef, useState } from "react";
import { AnimationDirector } from "./character-engine/director";
import { GrokCharacter } from "./character-engine/GrokCharacter";
import { CharacterDirective, GrokOneShot } from "./character-engine/types";
import { CodexOverview, PetSettings } from "./types";
import { EMPTY_CODEX_OVERVIEW } from "../electron/defaults";
import { DEFAULT_SETTINGS } from "../electron/settings";
import { petLayout } from "./pet-layout";

export default function App() {
  const [overview, setOverview] = useState<CodexOverview>(EMPTY_CODEX_OVERVIEW);
  const [settings, setSettings] = useState<PetSettings>(DEFAULT_SETTINGS);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const director = useRef(new AnimationDirector());
  const [directive, setDirective] = useState<CharacterDirective>(() => director.current.next(EMPTY_CODEX_OVERVIEW));
  const latestOverview = useRef(overview);
  const dragStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const dragMoved = useRef(false);
  const layout = petLayout(settings.characterSize);
  const layoutStyle = {
    "--pet-character-size": `${layout.characterSize}px`,
    "--pet-shadow-width": `${layout.shadowWidth}px`,
    "--pet-shadow-height": `${layout.shadowHeight}px`,
    "--pet-shadow-bottom": `${layout.shadowBottom}px`,
    "--pet-shadow-blur": `${layout.shadowBlur}px`,
    "--pet-drop-y": `${layout.dropY}px`,
    "--pet-drop-blur": `${layout.dropBlur}px`,
    "--pet-badge-size": `${layout.badgeSize}px`,
    "--pet-badge-inset": `${layout.badgeInset}px`,
    "--pet-badge-border": `${layout.badgeBorder}px`,
    "--pet-badge-font": `${layout.badgeFont}px`,
    "--pet-badge-padding": `${layout.badgePadding}px`
  } as CSSProperties;

  useEffect(() => {
    void window.pet.getOverview().then(setOverview);
    void window.pet.getSettings().then(setSettings);
    const offOverview = window.pet.onOverview(setOverview);
    const offSettings = window.pet.onSettings(setSettings);
    const offPointer = window.pet.onPointerDirection(setGaze);
    const rootStyle = document.documentElement.style;
    const offWindowOffset = window.pet.onPetWindowOffset((offset) => {
      rootStyle.setProperty("--pet-window-offset-x", `${offset.x}px`);
      rootStyle.setProperty("--pet-window-offset-y", `${offset.y}px`);
    });
    return () => {
      offOverview(); offSettings(); offPointer(); offWindowOffset();
      rootStyle.removeProperty("--pet-window-offset-x");
      rootStyle.removeProperty("--pet-window-offset-y");
    };
  }, []);

  useEffect(() => { latestOverview.current = overview; }, [overview]);
  useEffect(() => {
    const update = () => setDirective(director.current.next(latestOverview.current));
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, []);

  const beginDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragStart.current = { x: event.screenX, y: event.screenY };
    dragMoved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    void window.pet.beginDrag({ x: event.screenX, y: event.screenY });
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const start = dragStart.current;
    if (!start) return;
    if (!dragMoved.current && Math.hypot(event.screenX - start.x, event.screenY - start.y) >= 4) {
      dragMoved.current = true;
      setDirective(director.current.force("dragging"));
    }
    if (dragMoved.current) void window.pet.dragTo({ x: event.screenX, y: event.screenY });
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    dragStart.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    void window.pet.endDrag();
    if (dragMoved.current) setDirective(director.current.force("bouncing", Date.now(), "bounce"));
  };

  const play = () => {
    if (dragMoved.current) { dragMoved.current = false; return; }
    if (!settings.clickInteractions) return;
    const tricks: GrokOneShot[] = ["bounce", "spin", "burst", "wild-spin"];
    const trick = tricks[Math.floor(Math.random() * tricks.length)];
    setDirective(director.current.force(trick === "bounce" ? "bouncing" : "playful", Date.now(), trick));
  };

  return (
    <main className={`app-shell ${settings.shadowsEnabled ? "shadows-enabled" : "shadows-disabled"}`} style={layoutStyle}>
      <button
        className="pet-surface"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={play}
        aria-label="拖动或点击 Grok Bot"
      >
        <span className="pet-shadow" aria-hidden="true" />
        <GrokCharacter
          directive={settings.autoShape ? directive : { ...directive, shape: settings.fixedShape }}
          pointerFollowing={settings.pointerFollowing}
          gaze={gaze}
          size={layout.characterSize}
          bodyColor={settings.statusColorsEnabled && directive.statusColorRole
            ? settings.statusColors[directive.statusColorRole]
            : settings.bodyColor}
          eyeColor={settings.eyeColor}
        />
        {settings.showBadge && overview.activeCount > 0 && <span className="count-badge">{overview.activeCount}</span>}
      </button>
    </main>
  );
}
