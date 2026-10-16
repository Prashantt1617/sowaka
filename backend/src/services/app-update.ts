/**
 * Whether the app in someone's hand must, or may, update: the company's rule
 * (Company.appUpdate) against the version the app reports. Pure, so the
 * check script covers it without a database.
 */
import type { AppUpdateRule } from '../models/company.model';

export type AppPlatform = 'ios' | 'android';
export type AppUpdateMode = 'force' | 'optional' | 'none';

/** Where each build is installed from. */
export const STORE_URLS: Record<AppPlatform, string> = {
  ios: 'https://apps.apple.com/app/id6791144997',
  android: 'https://play.google.com/store/apps/details?id=com.sowaka.connect',
};

export function parsePlatform(value: unknown): AppPlatform | null {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'ios' || text === 'android' ? text : null;
}

/** "1.3.8+41" → [1, 3, 8] and 41; null when it is not a version. */
export function parseVersion(value: unknown): { parts: number[]; build: number | null } | null {
  const match = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\+(\d+))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    build: match[4] === undefined ? null : Number(match[4]),
  };
}

/**
 * Whether `app` is older than `required`. A rule that names a build compares
 * builds too; one that does not ("1.3.8") is met by any build of 1.3.8.
 */
export function isOlder(app: string, required: string): boolean {
  const have = parseVersion(app);
  const need = parseVersion(required);
  if (!need) return false;
  // An app that sends no version is from before this check, or broken: it
  // cannot be told apart from an old one, so it is treated as one.
  if (!have) return true;
  for (let i = 0; i < 3; i += 1) {
    if (have.parts[i] !== need.parts[i]) return have.parts[i] < need.parts[i];
  }
  if (need.build === null) return false;
  return (have.build ?? 0) < need.build;
}

export function updateFor(
  rule: AppUpdateRule | undefined,
  platform: AppPlatform,
  appVersion: string,
): { mode: AppUpdateMode; version?: string; storeUrl?: string } {
  const force = rule?.force?.[platform];
  if (force && isOlder(appVersion, force)) return { mode: 'force', version: force, storeUrl: STORE_URLS[platform] };
  const optional = rule?.optional?.[platform];
  if (optional && isOlder(appVersion, optional)) return { mode: 'optional', version: optional, storeUrl: STORE_URLS[platform] };
  return { mode: 'none' };
}
