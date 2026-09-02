import { contextBridge, ipcRenderer } from "electron";
import { CodexOverview, PetSettings } from "./types";

interface PetApi {
  appLocale: "zh" | "en";
  getOverview(): Promise<CodexOverview>;
  refresh(): Promise<CodexOverview>;
  getSettings(): Promise<PetSettings>;
  setSettings(patch: Partial<PetSettings>): Promise<PetSettings>;
  previewSettings(patch: Partial<PetSettings>): Promise<PetSettings>;
  beginDrag(point: { x: number; y: number }): Promise<void>;
  dragTo(point: { x: number; y: number }): Promise<void>;
  endDrag(): Promise<void>;
  openCodex(): Promise<void>;
  quit(): Promise<void>;
  isPetVisible(): Promise<boolean>;
  togglePet(): Promise<boolean>;
  closeSettingsPanel(): Promise<void>;
  getAppVersion(): Promise<string>;
  onOverview(listener: (overview: CodexOverview) => void): () => void;
  onSettings(listener: (settings: PetSettings) => void): () => void;
  onPointerDirection(listener: (direction: { x: number; y: number }) => void): () => void;
  onPetWindowOffset(listener: (offset: { x: number; y: number }) => void): () => void;
  onSettingsShown(listener: () => void): () => void;
}

const appLocale = process.argv.find((argument) => argument.startsWith("--app-locale="))?.slice("--app-locale=".length) === "zh" ? "zh" : "en";
const api: PetApi = {
  appLocale,
  getOverview: () => ipcRenderer.invoke("codex:getOverview"),
  refresh: () => ipcRenderer.invoke("codex:refresh"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<PetSettings>) => ipcRenderer.invoke("settings:set", patch),
  previewSettings: (patch: Partial<PetSettings>) => ipcRenderer.invoke("settings:preview", patch),
  beginDrag: async (point) => { ipcRenderer.send("window:beginDrag", point); },
  dragTo: async (point) => { ipcRenderer.send("window:dragTo", point); },
  endDrag: async () => { ipcRenderer.send("window:endDrag"); },
  openCodex: () => ipcRenderer.invoke("codex:open"),
  quit: () => ipcRenderer.invoke("app:quit"),
  isPetVisible: () => ipcRenderer.invoke("pet:isVisible"),
  togglePet: () => ipcRenderer.invoke("pet:toggle"),
  closeSettingsPanel: () => ipcRenderer.invoke("settings:closePanel"),
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  onOverview: (listener: (overview: CodexOverview) => void) => { const callback = (_event: Electron.IpcRendererEvent, overview: CodexOverview) => listener(overview); ipcRenderer.on("codex:overview", callback); return () => ipcRenderer.removeListener("codex:overview", callback); },
  onSettings: (listener: (settings: PetSettings) => void) => { const callback = (_event: Electron.IpcRendererEvent, next: PetSettings) => listener(next); ipcRenderer.on("settings:changed", callback); return () => ipcRenderer.removeListener("settings:changed", callback); },
  onPointerDirection: (listener: (direction: { x: number; y: number }) => void) => { const callback = (_event: Electron.IpcRendererEvent, direction: { x: number; y: number }) => listener(direction); ipcRenderer.on("pointer:direction", callback); return () => ipcRenderer.removeListener("pointer:direction", callback); },
  onPetWindowOffset: (listener: (offset: { x: number; y: number }) => void) => { const callback = (_event: Electron.IpcRendererEvent, offset: { x: number; y: number }) => listener(offset); ipcRenderer.on("pet:windowOffset", callback); return () => ipcRenderer.removeListener("pet:windowOffset", callback); },
  onSettingsShown: (listener: () => void) => { const callback = () => listener(); ipcRenderer.on("settings:shown", callback); return () => ipcRenderer.removeListener("settings:shown", callback); }
};
contextBridge.exposeInMainWorld("pet", api);
