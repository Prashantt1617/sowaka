// Figma story Like heart (28 px, stroke 2.1). Paths exported from Figma (file iR1u5kUixarUHeVIU6jiHn); the colour follows `color`.
export function G2Heart({ size = 28, color = '#0571A6', filled = false }: { size?: number; color?: string; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true" style={{ color, flex: 'none', display: 'block' }}>
      <g transform="translate(4.7833 6.003)"><path d="M9.21667 17.3303C9.21667 17.3303 1.05 12.0803 1.05 5.66363C1.06072 4.72028 1.35711 3.80232 1.90008 3.03082C2.44306 2.25932 3.20711 1.6705 4.09149 1.34202C4.97588 1.01353 5.93905 0.960806 6.85401 1.19079C7.76896 1.42078 8.59272 1.92268 9.21667 2.6303C9.84061 1.92268 10.6644 1.42078 11.5793 1.19079C12.4943 0.960806 13.4575 1.01353 14.3418 1.34202C15.2262 1.6705 15.9903 2.25932 16.5332 3.03082C17.0762 3.80232 17.3726 4.72028 17.3833 5.66363C17.3833 12.0803 9.21667 17.3303 9.21667 17.3303Z" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" fill={filled ? "currentColor" : "none"} /></g>
    </svg>
  );
}
