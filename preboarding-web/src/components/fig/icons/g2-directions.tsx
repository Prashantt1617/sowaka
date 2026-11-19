// Figma "Get directions" arrow (20 px). Paths exported from Figma (file iR1u5kUixarUHeVIU6jiHn); the colour follows `color`.
export function G2Directions({ size = 20, color = '#0571A6' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ color, flex: 'none', display: 'block' }}>
      <path d="M2.5 9.16667L17.5 2.5L10.8333 17.5L9.16667 10.8333L2.5 9.16667Z" strokeWidth={1.66667} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" />
    </svg>
  );
}
