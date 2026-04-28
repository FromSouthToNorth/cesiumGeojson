/* ==============================
 * Popup visual variant definitions
 * 3 UI styles for the map popup bubble
 * ============================== */

export type PopupVariantKey = 'glass' | 'minimal' | 'card';

export interface PopupVariant {
  key: PopupVariantKey;
  label: string;
  labelCN: string;
}

export const POPUP_VARIANTS: PopupVariant[] = [
  { key: 'glass', label: 'Glassmorphism', labelCN: '玻璃态' },
  { key: 'minimal', label: 'Minimal', labelCN: '极简' },
  { key: 'card', label: 'Card', labelCN: '卡片' },
];

export function getNextVariant(current: PopupVariantKey): PopupVariantKey {
  const idx = POPUP_VARIANTS.findIndex((v) => v.key === current);
  return POPUP_VARIANTS[(idx + 1) % POPUP_VARIANTS.length].key;
}
