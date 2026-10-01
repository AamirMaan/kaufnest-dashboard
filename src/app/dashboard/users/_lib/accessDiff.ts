import { ROLE_DEFAULTS, SECTION_KEYS, type AccessLevel, type AccessMap, type Section } from "@/lib/permissions/sections";
import type { UserRole } from "@/types";

/** Stored exception rows → full grid (role defaults overlaid). No plan ceiling: the editor shows stored intent. */
export function exceptionsToGrid(role: UserRole, rows: { section: Section; level: AccessLevel }[]): AccessMap {
  const grid = { ...ROLE_DEFAULTS[role] };
  for (const r of rows) grid[r.section] = r.level;
  return grid;
}

/** What to write when saving: only changed cells; a cell equal to the role default is a delete. */
export function diffAccess(role: UserRole, saved: AccessMap, edited: AccessMap) {
  const upserts: { section: Section; level: AccessLevel }[] = [];
  const deletes: Section[] = [];
  for (const k of SECTION_KEYS) {
    if (edited[k] === saved[k]) continue;
    if (edited[k] === ROLE_DEFAULTS[role][k]) deletes.push(k);
    else upserts.push({ section: k, level: edited[k] });
  }
  return { upserts, deletes };
}

export function customSections(role: UserRole, grid: AccessMap): Section[] {
  return SECTION_KEYS.filter((k) => grid[k] !== ROLE_DEFAULTS[role][k]);
}
