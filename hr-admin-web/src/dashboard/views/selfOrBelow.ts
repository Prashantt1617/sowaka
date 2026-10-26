import type { Emp } from '../seed';

export function isSelfOrBelow(emps: Emp[], editorId: string, emp: Emp): boolean {
  const byId = new Map(emps.map((e) => [e.id, e]));
  const seen = new Set<string>();
  let current: Emp | undefined = emp;
  while (current && !seen.has(current.id)) {
    if (current.id === editorId) return true;
    seen.add(current.id);
    current = current.managerId ? byId.get(current.managerId) : undefined;
  }
  return false;
}
