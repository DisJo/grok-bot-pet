export interface PetBounds { x: number; y: number; width: number; height: number; }
export interface PetPoint { x: number; y: number; }

export interface MovablePetWindowLike {
  getBounds(): PetBounds;
  setPosition(x: number, y: number, animate?: boolean): void;
  getNativeWindowHandle(): Buffer;
}

export interface NativeWindowMover {
  offsetWindow(nativeHandle: Buffer, dx: number, dy: number): boolean;
  getWindowFrame?(nativeHandle: Buffer): PetBounds | undefined;
}

export function petWindowSize(characterSize: number) {
  const size = Math.min(320, Math.max(64, Math.round(characterSize)));
  const scale = size / 270;
  const shadowHeight = Math.max(6, Math.round(22 * scale));
  const shadowBlur = Math.max(3, Math.round(11 * scale));
  const effectOverscan = Math.ceil(size * 0.5) + 4;
  const shadowOverscan = Math.round(shadowHeight / 2) + shadowBlur * 4 + 4;
  const dropY = Math.max(5, Math.round(20 * scale));
  const dropBlur = Math.max(6, Math.round(24 * scale));
  const filteredEffectOverscan = effectOverscan + dropY + dropBlur * 3 + 4;
  const margin = Math.max(filteredEffectOverscan, shadowOverscan);
  return size + margin * 2;
}

export function isFinitePoint(point: PetPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function petHitTargetContains(
  pointer: PetPoint,
  windowBounds: PetBounds,
  offset: PetPoint,
  characterSize: number
) {
  if (!isFinitePoint(pointer) || !isFiniteBounds(windowBounds) || !isFinitePoint(offset)) return false;
  const size = Math.min(320, Math.max(64, Math.round(characterSize)));
  const half = size / 2;
  const centerX = windowBounds.x + windowBounds.width / 2 + offset.x;
  const centerY = windowBounds.y + windowBounds.height / 2 + offset.y;
  return pointer.x >= centerX - half
    && pointer.x <= centerX + half
    && pointer.y >= centerY - half
    && pointer.y <= centerY + half;
}

export function petMovementBounds(displayBounds: PetBounds, _workArea: PetBounds): PetBounds {
  return { ...displayBounds };
}

function isFiniteBounds(bounds: PetBounds) {
  return isFinitePoint(bounds)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

export function movePetWindow(
  window: MovablePetWindowLike,
  nativeBridge: NativeWindowMover,
  logicalBounds: PetBounds,
  targetPosition: PetPoint
): PetBounds {
  if (!isFiniteBounds(logicalBounds) || !isFinitePoint(targetPosition)) return logicalBounds;
  try {
    window.setPosition(targetPosition.x, targetPosition.y, false);
  } catch {
    return logicalBounds;
  }

  let reportedBounds: PetBounds;
  try {
    reportedBounds = window.getBounds();
  } catch {
    return logicalBounds;
  }
  if (!isFiniteBounds(reportedBounds)) return logicalBounds;

  let correctionBounds = reportedBounds;
  let nativeHandle: Buffer;
  try {
    nativeHandle = window.getNativeWindowHandle();
    const nativeBounds = nativeBridge.getWindowFrame?.(nativeHandle);
    if (nativeBounds && isFiniteBounds(nativeBounds)) correctionBounds = nativeBounds;
  } catch {
    return reportedBounds;
  }

  const dx = targetPosition.x - correctionBounds.x;
  const dy = targetPosition.y - correctionBounds.y;
  if (dx === 0 && dy === 0) return { ...correctionBounds, x: targetPosition.x, y: targetPosition.y };
  try {
    if (nativeBridge.offsetWindow(nativeHandle, dx, dy)) {
      return { ...correctionBounds, x: targetPosition.x, y: targetPosition.y };
    }
  } catch {}
  return reportedBounds;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function centeredRange(start: number, length: number, itemLength: number) {
  if (itemLength > length) return { min: start, max: start };
  return { min: start, max: start + length - itemLength };
}

function clampPetCenter(value: number, start: number, length: number, characterSize: number) {
  const radius = characterSize / 2;
  const minimumVisible = Math.min(32, radius, length / 2);
  return clamp(
    value,
    start - radius + minimumVisible,
    start + length + radius - minimumVisible
  );
}

export function petWindowPositionForCenter(center: PetPoint, windowBounds: PetBounds, workArea: PetBounds): PetPoint {
  const xRange = centeredRange(workArea.x, workArea.width, windowBounds.width);
  const yRange = centeredRange(workArea.y, workArea.height, windowBounds.height);
  return {
    x: Math.round(clamp(center.x - windowBounds.width / 2, xRange.min, xRange.max)),
    y: Math.round(clamp(center.y - windowBounds.height / 2, yRange.min, yRange.max))
  };
}

export function petOffsetForCenter(
  center: PetPoint,
  actualWindowBounds: PetBounds,
  workArea: PetBounds,
  characterSize: number
): PetPoint {
  const clampedCenter = {
    x: clampPetCenter(center.x, workArea.x, workArea.width, characterSize),
    y: clampPetCenter(center.y, workArea.y, workArea.height, characterSize)
  };
  return {
    x: Math.round(clampedCenter.x - (actualWindowBounds.x + actualWindowBounds.width / 2)),
    y: Math.round(clampedCenter.y - (actualWindowBounds.y + actualWindowBounds.height / 2))
  };
}

export function settingsWindowBounds(workArea: PetBounds, trayBounds: PetBounds, menuAtTop: boolean): PetBounds {
  const margin = 8;
  const anchorGap = 6;
  const width = Math.min(390, Math.max(1, workArea.width - margin * 2));
  const minX = workArea.x + margin;
  const maxX = workArea.x + workArea.width - width - margin;
  const x = Math.round(Math.min(maxX, Math.max(minX, trayBounds.x + trayBounds.width / 2 - width / 2)));
  const topEdge = workArea.y + margin;
  const bottomEdge = workArea.y + workArea.height - margin;
  if (menuAtTop) {
    const y = Math.round(Math.max(topEdge, trayBounds.y + trayBounds.height + anchorGap));
    return { x, y, width, height: Math.max(1, Math.min(720, Math.floor(bottomEdge - y))) };
  }
  const bottom = Math.min(bottomEdge, trayBounds.y - anchorGap);
  const height = Math.max(1, Math.min(720, Math.floor(bottom - topEdge)));
  return { x, y: Math.round(bottom - height), width, height };
}
