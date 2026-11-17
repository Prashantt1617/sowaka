/**
 * For one script only (`scripts/lifecycle-demo-seed.ts`), in its own process: the lifecycle's
 * timed jobs touch only the journeys and people the script made, and the script's company is
 * treated as having the lifecycle (and exits) switched on. The company's row is never changed,
 * and the live server never sets a scope, so for it every check below is a no-op.
 */
export interface ScriptScope {
  org: string;
  journeyIds: Set<string>;
  userIds: Set<string>;
}

let scope: ScriptScope | null = null;

export function setScriptScope(next: ScriptScope | null): void {
  scope = next;
}

export function scriptScope(): ScriptScope | null {
  return scope;
}

/** True only inside the demo-seed script, for its company. */
export function scriptForcesFeatures(org: string | undefined): boolean {
  return !!scope && !!org && scope.org === org;
}

/** A Mongo filter piece: within a scope, only the scope's journeys (by `field`); otherwise nothing extra. */
export function scopedJourneys(field = 'id'): Record<string, unknown> {
  return scope ? { [field]: { $in: [...scope.journeyIds] } } : {};
}

/** A Mongo filter piece: within a scope, only the scope's people (by `field`); otherwise nothing extra. */
export function scopedUsers(field = 'userId'): Record<string, unknown> {
  return scope ? { [field]: { $in: [...scope.userIds] } } : {};
}
