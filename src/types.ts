import type { CodexOverview, PetSettings } from "../electron/types";

export type {
  CodexActivityKind,
  CodexActivitySignal,
  CodexOverview,
  CodexTask,
  CodexTaskStatus,
  GrokColor,
  PetSettings
} from "../electron/types";

export interface PetApi {
  appLocale: "zh" | "en";
  getOverview(): Promise<CodexOverview>;
  refresh(): Promise<CodexOverview>;
  getSettings(): Promise<PetSettings>;
  setSettings(patch: Partial<PetSettings>): Promise<PetSettings>;
  beginDrag(point: { x: number; y: number }): Promise<void>;
  dragTo(point: { x: number; y: number }): Promise<void>;
  endDrag(): Promise<void>;
  openCodex(): Promise<void>;
  quit(): Promise<void>;
  isPetVisible(): Promise<boolean>;
  togglePet(): Promise<boolean>;
  previewSettings(patch: Partial<PetSettings>): Promise<PetSettings>;
  closeSettingsPanel(): Promise<void>;
  getAppVersion(): Promise<string>;
  onOverview(listener: (overview: CodexOverview) => void): () => void;
  onSettings(listener: (settings: PetSettings) => void): () => void;
  onPointerDirection(listener: (direction: { x: number; y: number }) => void): () => void;
  onPetWindowOffset(listener: (offset: { x: number; y: number }) => void): () => void;
  onSettingsShown(listener: () => void): () => void;
}

declare global {
  interface Window { pet: PetApi; }
}
