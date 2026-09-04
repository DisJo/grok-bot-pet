import { createRequire } from "node:module";
import { PetBounds } from "./pet-window";

export interface NativeWindowBinding {
  offsetWindow(nativeHandle: Buffer, electronDeltaX: number, electronDeltaY: number): boolean;
  setAlwaysOnTop(nativeHandle: Buffer, enabled: boolean): boolean;
  getWindowFrame(nativeHandle: Buffer): PetBounds | undefined;
  codexApprovalVisible(promptForPermission?: boolean): boolean | null;
}

type BindingLoader = (modulePath: string) => unknown;

const defaultLoader: BindingLoader = (modulePath) => createRequire(__filename)(modulePath);

function validHandle(value: Buffer) {
  return Buffer.isBuffer(value) && value.byteLength >= 8;
}

function validBounds(value: unknown): value is PetBounds {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Partial<PetBounds>;
  return [bounds.x, bounds.y, bounds.width, bounds.height].every((part) => typeof part === "number" && Number.isFinite(part))
    && (bounds.width ?? 0) > 0
    && (bounds.height ?? 0) > 0;
}

function validBinding(value: unknown): value is NativeWindowBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NativeWindowBinding>;
  return typeof candidate.offsetWindow === "function"
    && typeof candidate.setAlwaysOnTop === "function"
    && typeof candidate.getWindowFrame === "function"
    && typeof candidate.codexApprovalVisible === "function";
}

export class NativeWindowBridge {
  private binding: NativeWindowBinding | null | undefined;

  constructor(private readonly modulePath: string, private readonly loader: BindingLoader = defaultLoader) {}

  private load() {
    if (this.binding !== undefined) return this.binding;
    try {
      const loaded = this.loader(this.modulePath);
      this.binding = validBinding(loaded) ? loaded : null;
    } catch {
      this.binding = null;
    }
    return this.binding;
  }

  offsetWindow(nativeHandle: Buffer, dx: number, dy: number) {
    if (!validHandle(nativeHandle) || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    try {
      return this.load()?.offsetWindow(nativeHandle, dx, dy) === true;
    } catch {
      return false;
    }
  }

  setAlwaysOnTop(nativeHandle: Buffer, enabled: boolean) {
    if (!validHandle(nativeHandle) || typeof enabled !== "boolean") return false;
    try {
      return this.load()?.setAlwaysOnTop(nativeHandle, enabled) === true;
    } catch {
      return false;
    }
  }

  getWindowFrame(nativeHandle: Buffer) {
    if (!validHandle(nativeHandle)) return undefined;
    try {
      const frame = this.load()?.getWindowFrame(nativeHandle);
      return validBounds(frame) ? frame : undefined;
    } catch {
      return undefined;
    }
  }

  codexApprovalVisible(promptForPermission = false) {
    if (typeof promptForPermission !== "boolean") return undefined;
    try {
      const visible = this.load()?.codexApprovalVisible(promptForPermission);
      return typeof visible === "boolean" ? visible : undefined;
    } catch {
      return undefined;
    }
  }

}
