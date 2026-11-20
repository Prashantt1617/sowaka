// Figma story "quick read" chevron: the design's 22 px back chevron (stroke 1.83) mirrored, as drawn in
// "App · Story · Policies". Path exported from Figma (file iR1u5kUixarUHeVIU6jiHn); the colour follows `color`.
export function G2ChevronRight({ size = 22, color = '#16181D' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ color, flex: 'none', display: 'block' }}>
      <g transform="translate(22 0) scale(-1 1) translate(7.3333 4.5833)"><path d="M6.41667 0.916667L0.916667 6.41667L6.41667 11.9167" strokeWidth={1.83333} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" /></g>
    </svg>
  );
}
