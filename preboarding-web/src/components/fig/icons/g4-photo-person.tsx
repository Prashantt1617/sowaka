// From Figma (Sowaka Connect, No photo yet person, 64 box). Colour follows currentColor.
export function G4PhotoPerson({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path transform="translate(19.467 8.8)" d="M23.2 12.5333C23.2 18.4244 18.4244 23.2 12.5333 23.2C6.6423 23.2 1.86667 18.4244 1.86667 12.5333C1.86667 6.6423 6.6423 1.86667 12.5333 1.86667C18.4244 1.86667 23.2 6.6423 23.2 12.5333Z" stroke="currentColor" strokeWidth="3.73333" strokeLinecap="round" strokeLinejoin="round" /><path transform="translate(8.8 38.133)" d="M1.86667 17.8667C1.86667 7.2 12.5333 1.86667 23.2 1.86667C33.8667 1.86667 44.5333 7.2 44.5333 17.8667" stroke="currentColor" strokeWidth="3.73333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
