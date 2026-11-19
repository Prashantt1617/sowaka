// Figma "Take a photo" camera (20 px). Paths exported from Figma (file iR1u5kUixarUHeVIU6jiHn); the colour follows `color`.
export function G2Camera({ size = 20, color = '#0571A6' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ color, flex: 'none', display: 'block' }}>
      <path d="M3.33333 6.66667H5.83333L7.5 4.16667H12.5L14.1667 6.66667H16.6667V16.6667H3.33333V6.66667Z" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" /><path d="M12.9167 10.8333C12.9167 12.4442 11.6108 13.75 10 13.75C8.38917 13.75 7.08333 12.4442 7.08333 10.8333C7.08333 9.2225 8.38917 7.91667 10 7.91667C11.6108 7.91667 12.9167 9.2225 12.9167 10.8333Z" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" />
    </svg>
  );
}
