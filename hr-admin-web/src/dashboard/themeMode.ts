// Light / dark / follow-the-system, remembered on this device. index.html
// applies the saved choice before first paint; this keeps it in step after.
export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'sowaka.theme';

export function readThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try {
    if (mode === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
