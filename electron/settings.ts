import { GrokColor, PetSettings, StatusColorRole } from "./types";

export const DEFAULT_STATUS_COLORS: Record<StatusColorRole, GrokColor> = {
  completed: "green",
  error: "red",
  stopped: "gray",
  waiting: "yellow"
};

const CUSTOM_DEFAULTS = {
  opacity: 1,
  pointerFollowing: true,
  showBadge: true,
  shadowsEnabled: true,
  characterSize: 270,
  bodyColor: "black",
  eyeColor: "#ffffff",
  autoShape: false,
  fixedShape: "blob",
  clickInteractions: true,
  statusColorsEnabled: true,
  statusColors: DEFAULT_STATUS_COLORS
} as const;

export const DEFAULT_SETTINGS: PetSettings = {
  settingsVersion: 5,
  launchAtLogin: true,
  alwaysOnTop: true,
  activeOnly: false,
  ...CUSTOM_DEFAULTS
};

type StoredSettings = Omit<Partial<PetSettings>, "characterSize"> & { characterSize?: number | "compact" | "standard" | "large"; animations?: unknown; skin?: unknown };

export function normalizeSettings(stored: StoredSettings = {}): PetSettings {
  const { animations: _removedAnimationPreference, skin: _removedSkinPreference, ...cleanStored } = stored;
  const previousVersion = stored.settingsVersion ?? 1;
  const legacySize = stored.characterSize;
  const characterSize = typeof legacySize === "number"
    ? Math.min(320, Math.max(64, Math.round(legacySize)))
    : ({ compact: 224, standard: 270, large: 310 } as const)[legacySize || "standard"];
  const statusColors = { ...DEFAULT_STATUS_COLORS, ...(stored.statusColors || {}) };
  if (previousVersion < 5 && statusColors.waiting === "orange") statusColors.waiting = "yellow";
  return {
    ...DEFAULT_SETTINGS,
    ...cleanStored,
    statusColors,
    ...(previousVersion < 2 ? { autoShape: false, fixedShape: "blob" as const } : {}),
    ...(previousVersion < 3 ? { statusColorsEnabled: true } : {}),
    characterSize,
    opacity: Math.min(1, Math.max(0.35, Number(stored.opacity ?? DEFAULT_SETTINGS.opacity))),
    settingsVersion: 5
  };
}
