// Per-company dressing for the dashboard.
//
// A company that has its own brand signs in to its own face: their logo in
// place of Sowaka's mark, their name, and — for Convrse — a render of their
// lobby behind the sign-in card. Everyone else gets Sowaka's.
//
// Which company it is comes from, in order: the hostname (once orgs get their
// own subdomains), the signed-in user, and failing both the last company that
// signed in on this device — so the sign-in screen, where nobody is signed in
// yet, still wears the right face on the second visit.
import { useAuth } from './auth/AuthContext';

export type Brand = {
  /** What to call them on the sign-in card and in the sidebar. */
  name?: string;
  /** Their app icon, filling the square tile Sowaka's mark otherwise sits in. */
  icon?: string;
  /**
   * Their name set the way they set it: their own weight, case and colour,
   * rather than a logo file. A picture of a wordmark looks pasted on beside
   * type the browser is rendering; the same letters in their style do not.
   */
  wordmark?: { text: string; weight: number; letterSpacing: string; color: string; lowercase?: boolean };
  /** Behind the sign-in card. */
  backdrop?: string;
};

const BRANDS: Record<string, Brand> = {
  convrse: {
    name: 'Convrse Spaces',
    icon: '/brand/convrse-icon.png',
    // Their mark is lowercase, light and wide, in their violet.
    wordmark: { text: 'convrse spaces', weight: 300, letterSpacing: '-.01em', color: '#6C5CE7', lowercase: true },
    backdrop: '/backgrounds/convrse.jpg',
  },
  acmt: {
    name: 'ACMT Group of Colleges',
    icon: '/brand/acmt-icon.png',
    // Their seal sets ACMT in a heavy red face on the navy; the navy carries better as type.
    wordmark: { text: 'ACMT', weight: 800, letterSpacing: '-.02em', color: '#1B1464' },
  },
};

const LAST_ORG_KEY = 'sowaka.brandOrg';

/** Noted at sign-in, read at the next sign-in screen. */
export function rememberBrandOrg(org: string | undefined) {
  try {
    if (org) localStorage.setItem(LAST_ORG_KEY, org.toLowerCase());
  } catch {
    // Storage blocked: the next sign-in screen is plain, nothing worse.
  }
}

function fromHostname(): string | null {
  const host = typeof window === 'undefined' ? '' : window.location.hostname;
  const label = host.split('.')[0]?.toLowerCase() ?? '';
  return label in BRANDS ? label : null;
}

function fromStorage(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

/** This company's face, empty for Sowaka's own. */
export function useBrand(): Brand {
  const { user } = useAuth();
  const byUser = (user?.org ?? '').toLowerCase()
    || Object.keys(BRANDS).find((k) => (user?.company ?? '').toLowerCase().includes(k))
    || '';
  const org = fromHostname() ?? (byUser || fromStorage()) ?? '';
  return BRANDS[org] ?? {};
}
