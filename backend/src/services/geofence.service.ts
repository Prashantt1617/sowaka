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
  // An edit names an office of this org, or it is not an edit.
  const current = input.id ? await offices().findOne({ id: input.id, org }) : null;
  if (input.id && !current) throw new Error('Office not found');
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Give the office a name');
  const radius = input.radiusMeters === undefined ? undefined : Number(input.radiusMeters);
  if (radius !== undefined && !(Number.isFinite(radius) && radius > 0)) {
    throw new Error('Radius must be a number of metres above zero');
  }
  const office: Office = {
    id: input.id ?? randomUUID(),
    org,
    name,
    city: String(input.city ?? '').trim() || undefined,
    latitude: Number(input.latitude),
    longitude: Number(input.longitude),
    radiusMeters: radius ?? current?.radiusMeters ?? DEFAULT_OFFICE_RADIUS_METERS,
    // An edit that says nothing about `active` leaves it as it was.
    active: input.active ?? current?.active ?? true,
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
    { id: office.id, org },
    { $set: mutable, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return office;
}

/**
 * Removes an office. Punches already taken there keep the office's name and
 * distance on their own record, so nothing in history goes blank.
 */
export async function deleteOffice(org: string, id: string) {
  const result = await offices().deleteOne({ id, org });
  if (result.deletedCount === 0) throw new Error('Office not found');
}

/**
 * Where a punch was taken, in words a manager can use: "1.2 km from Sowaka
 * Office". No map lookup — the offices HR set up are the only places the
 * product knows, and a distance from the nearest one says enough.
 */
export function placeLabel(distanceMeters?: number, officeName?: string): string {
  if (distanceMeters == null || !Number.isFinite(distanceMeters)) {
    return officeName ? `Away from ${officeName}` : 'Away from office';
  }
  const distance = distanceMeters < 1000
    ? `${Math.round(distanceMeters)} m`
    : `${(distanceMeters / 1000).toFixed(distanceMeters < 10_000 ? 1 : 0)} km`;
  return `${distance} from ${officeName ?? 'office'}`;
}
