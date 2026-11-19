// Figma "From gallery" image (20 px). Paths exported from Figma (file iR1u5kUixarUHeVIU6jiHn); the colour follows `color`.
export function G2Gallery({ size = 20, color = '#0571A6' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ color, flex: 'none', display: 'block' }}>
      <path d="M4.16667 3.33333H15.8333C16.7538 3.33333 17.5 4.07953 17.5 5V15C17.5 15.9205 16.7538 16.6667 15.8333 16.6667H4.16667C3.24619 16.6667 2.5 15.9205 2.5 15V5C2.5 4.07953 3.24619 3.33333 4.16667 3.33333Z" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" /><path d="M9.16667 8.33333C9.16667 9.25381 8.42047 10 7.5 10C6.57953 10 5.83333 9.25381 5.83333 8.33333C5.83333 7.41286 6.57953 6.66667 7.5 6.66667C8.42047 6.66667 9.16667 7.41286 9.16667 8.33333Z" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" /><path d="M17.5 13.3333L13.3333 9.16667L5.83333 16.6667" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" />
    </svg>
  );
}
