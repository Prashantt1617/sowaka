/**
 * A place an employee may punch in from.
 *
 * An org has as many of these as it has sites — Gurgaon and Kolkata today —
 * and a punch is matched against the nearest one rather than a single
 * company-wide point.
 */
export interface Office {
  id: string;
  org: string;
  /** What the punch card names when it matches here, e.g. "Sowaka Office". */
  name: string;
  /** Shown beside the name, e.g. "Gurgaon". */
  city?: string;
  latitude: number;
  longitude: number;
  /**
   * How far from the point still counts as being here, in metres.
   *
   * Generous on purpose. A phone indoors is routinely 50-80m off its true
   * position, and a fence drawn tight around the building rejects people
   * sitting at their desks. Wide enough to cover the building and its car
   * park, narrow enough that the next street over does not qualify.
   */
  radiusMeters: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Used when an office is saved without one. */
export const DEFAULT_OFFICE_RADIUS_METERS = 200;

/**
 * The worst GPS accuracy a punch may be judged on, in metres.
 *
 * A fix carries its own error radius, and one of several hundred metres says
 * nothing about which building someone is in — accepting it would let a bad
 * reading pass someone who is at home and fail someone at their desk. Past
 * this the punch is refused and the employee asked to try again.
 */
export const MAX_PUNCH_ACCURACY_METERS = 100;

/** Where a punch was taken, as the device reported it. */
export interface PunchLocation {
  latitude: number;
  longitude: number;
  /** The fix's own error radius, in metres. */
  accuracy?: number;
  /** The OS said the position came from a mock provider. */
  mocked?: boolean;
  /** Office it matched, when it matched one. */
  officeId?: string;
  officeName?: string;
  /** Metres from that office's centre. */
  distanceMeters?: number;
  /**
   * Punched deliberately away from the office — a client site or a visit.
   * The day stands as worked, but marked, so it reads as the exception it is.
   */
  offsite?: boolean;
}
