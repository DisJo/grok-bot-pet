export interface PetLayout {
  characterSize: number;
  windowMargin: number;
  shadowWidth: number;
  shadowHeight: number;
  shadowBottom: number;
  shadowBlur: number;
  dropY: number;
  dropBlur: number;
  badgeSize: number;
  badgeInset: number;
  badgeBorder: number;
  badgeFont: number;
  badgePadding: number;
}

export function petLayout(requestedSize: number): PetLayout {
  const characterSize = Math.min(320, Math.max(64, Math.round(requestedSize)));
  const scale = characterSize / 270;
  const badgeSize = 28;
  const badgeRadius = badgeSize / 2;
  const badgeGap = 8;
  const badgeInset = Math.round(
    characterSize / 2
      - (characterSize / 2 + badgeRadius + badgeGap) / Math.SQRT2
      - badgeRadius
  );
  const shadowHeight = Math.max(6, Math.round(22 * scale));
  const shadowBlur = Math.max(3, Math.round(11 * scale));
  const effectOverscan = Math.ceil(characterSize * 0.5) + 4;
  const shadowOverscan = Math.round(shadowHeight / 2) + shadowBlur * 4 + 4;
  const dropY = Math.max(5, Math.round(20 * scale));
  const dropBlur = Math.max(6, Math.round(24 * scale));
  const filteredEffectOverscan = effectOverscan + dropY + dropBlur * 3 + 4;
  const windowMargin = Math.max(filteredEffectOverscan, shadowOverscan);
  return {
    characterSize,
    windowMargin,
    shadowWidth: Math.max(36, Math.round(152 * scale)),
    shadowHeight,
    shadowBottom: -Math.round(shadowHeight / 2),
    shadowBlur,
    dropY,
    dropBlur,
    badgeSize,
    badgeInset,
    badgeBorder: 0,
    badgeFont: 12,
    badgePadding: 7
  };
}
