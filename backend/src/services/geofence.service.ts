import { randomUUID } from 'node:crypto';
import { offices } from '../config/db';
import {
  DEFAULT_OFFICE_RADIUS_METERS,
  MAX_PUNCH_ACCURACY_METERS,
  Office,
  PunchLocation,
} from '../models/office.model';

/**
 * Metres between two points on the earth's surface.
 *
 * Haversine on a sphere. Good to a fraction of a percent at the distances that
 * matter here, where the question is "is this person in the building" rather
 * than anything needing a proper ellipsoid.
 */
export function distanceMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

export type GeofenceVerdict =
  | { inside: true; office: Office; distanceMeters: number }
  | {
      inside: false;
      reason: 'no_offices' | 'inaccurate' | 'outside';
      /** The closest office, when there was one to be closest to. */
      office?: Office;
      distanceMeters?: number;
    };

/**
 * Whether a reading puts someone at one of their org's offices.
 *
 * The nearest office wins rather than the first — an org with two sites should
 * name the one the person is actually at. A reading too vague to place is
 * refused outright rather than guessed at: passing it would let a bad fix
 * admit someone at home, and failing it would turn away someone at their desk.
 */
export async function locateForPunch(
  org: string,
  reading: { latitude: number; longitude: number; accuracy?: number },
): Promise<GeofenceVerdict> {
  const sites = await offices().find({ org, active: true }).toArray();
  if (sites.length === 0) return { inside: false, reason: 'no_offices' };

  let nearest: Office | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const site of sites) {
    const metres = distanceMeters(
      reading.latitude,
      reading.longitude,
      site.latitude,
      site.longitude,
    );
    if (metres < nearestDistance) {
      nearest = site;
      nearestDistance = metres;
    }
  }
  if (!nearest) return { inside: false, reason: 'no_offices' };

  if (
    typeof reading.accuracy === 'number' &&
    reading.accuracy > MAX_PUNCH_ACCURACY_METERS
  ) {
    return {
      inside: false,
      reason: 'inaccurate',
      office: nearest,
      distanceMeters: Math.round(nearestDistance),
    };
  }

  const radius = nearest.radiusMeters || DEFAULT_OFFICE_RADIUS_METERS;
  // The fix's own error works in the employee's favour: a reading 210m out
  // that is only accurate to 40m could genuinely be inside a 200m fence, and
  // turning that person away is worse than admitting someone on the pavement.
  const margin = Math.min(reading.accuracy ?? 0, MAX_PUNCH_ACCURACY_METERS);
  if (nearestDistance - margin <= radius) {
    return {
      inside: true,
      office: nearest,
      distanceMeters: Math.round(nearestDistance),
    };
  }
  return {
    inside: false,
    reason: 'outside',
    office: nearest,
    distanceMeters: Math.round(nearestDistance),
  };
}

/** What gets stored on the punch, whichever way the verdict went. */
export function punchLocationFrom(
  reading: { latitude: number; longitude: number; accuracy?: number; mocked?: boolean },
  verdict: GeofenceVerdict,
): PunchLocation {
  return {
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracy: reading.accuracy,
    mocked: reading.mocked,
    officeId: verdict.office?.id,
    officeName: verdict.office?.name,
    distanceMeters: verdict.distanceMeters,
  };
}

/** An office as the app shows it — no internal ids beyond the one it needs. */
export function officeView(office: Office) {
  return {
    id: office.id,
    name: office.name,
    city: office.city ?? '',
    latitude: office.latitude,
    longitude: office.longitude,
    radiusMeters: office.radiusMeters,
  };
}

/** The offices an org punches against, for the app and the dashboard. */
export async function listOffices(org: string) {
  return offices().find({ org }).sort({ name: 1 }).toArray();
}

export async function saveOffice(
  org: string,
  input: {
    id?: string;
    name: string;
    city?: string;
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    active?: boolean;
  },
) {
  const now = new Date();
  const radius = Number(input.radiusMeters);
  const office: Office = {
    id: input.id ?? randomUUID(),
    org,
    name: String(input.name ?? '').trim() || 'Office',
    city: String(input.city ?? '').trim() || undefined,
    latitude: Number(input.latitude),
    longitude: Number(input.longitude),
    radiusMeters:
      Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_OFFICE_RADIUS_METERS,
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
  };
  if (!Number.isFinite(office.latitude) || Math.abs(office.latitude) > 90) {
    throw new Error('Latitude must be between -90 and 90');
  }
  if (!Number.isFinite(office.longitude) || Math.abs(office.longitude) > 180) {
    throw new Error('Longitude must be between -180 and 180');
  }
  // createdAt is set once on insert, so it is not part of what an edit writes.
  const mutable: Partial<Office> = { ...office };
  delete mutable.createdAt;
  await offices().updateOne(
    { id: office.id },
    { $set: mutable, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return office;
}
