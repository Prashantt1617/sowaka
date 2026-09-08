// Who a KPI template applies to.
//
// Facets intersect: a populated facet must match, an empty one places no
// constraint. One definition drives the rule rows, the query preview and the
// live match count, so a new facet only has to be described once, here.
//
// No components, so the rule-row UI can live beside the screens that use it
// without tripping Fast Refresh.
import type { CSSProperties } from 'react';
import type { KpiTargeting } from '../services/kpi';
import type { Emp } from './seed';

export type FacetKey = keyof KpiTargeting;

export type FacetDef = {
  key: FacetKey;
  label: string;
  /** Column name used in the query preview. */
  column: string;
  /** The employee field this facet matches against. */
  valueOf: (e: Emp) => string;
  /** How a stored value reads — manager ids resolve to names. */
  display: (value: string, emps: Emp[]) => string;
};

export const FACETS: FacetDef[] = [
  { key: 'locations', label: 'Location', column: 'location', valueOf: (e) => e.location, display: (v) => v },
  // `Emp.role` is the person's job title; `Emp.team` is their department.
  { key: 'designations', label: 'Designation', column: 'designation', valueOf: (e) => e.role, display: (v) => v },
  { key: 'departments', label: 'Department', column: 'department', valueOf: (e) => e.team, display: (v) => v },
  {
    key: 'managerUserIds',
    label: 'Reports to',
    column: 'manager',
    valueOf: (e) => e.managerId,
    display: (v, emps) => emps.find((e) => e.id === v)?.name ?? '—',
  },
];

export const EMPTY_TARGET: KpiTargeting = {
  locations: [], designations: [], departments: [], managerUserIds: [],
};

/** Employees matching every populated facet — the same intersection the API applies. */
export function matchEmployees(emps: Emp[], target: KpiTargeting): Emp[] {
  return emps.filter((e) =>
    FACETS.every((f) => {
      const values = target[f.key];
      return values.length === 0 || values.includes(f.valueOf(e));
    }),
  );
}

/** Distinct values for a facet, off the roster so only real ones are offered. */
export function optionsFor(f: FacetDef, emps: Emp[]): string[] {
  const seen = new Set(emps.map(f.valueOf).filter((v) => v && v !== '—'));
  return [...seen].sort((a, b) => f.display(a, emps).localeCompare(f.display(b, emps)));
}

/** The rules as one readable line. */
export function targetSummary(target: KpiTargeting, emps: Emp[]): string {
  const parts = FACETS
    .filter((f) => target[f.key].length > 0)
    .map((f) => `${f.column} in (${target[f.key].map((v) => `'${f.display(v, emps)}'`).join(', ')})`);
  return parts.length ? parts.join(' and ') : 'everyone';
}

export const andLabel: CSSProperties = {
  flexShrink: 0, width: 40, marginTop: 13, fontSize: 12, fontWeight: 800,
  letterSpacing: '.06em', color: '#9197A2',
};

export const queryCode: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 13, color: '#3C6E9E', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};
