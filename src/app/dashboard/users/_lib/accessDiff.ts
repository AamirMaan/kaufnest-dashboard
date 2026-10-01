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

/** Sections whose Edit level requires Integrations: Edit (055's current_user_access dependency rule). */
const NEEDS_INTEGRATIONS: Section[] = ["listings", "messages"];

/**
 * Set one cell. Lowering Integrations below Edit also zeroes Listings and
 * Messages, so the editor never shows a grant the DB would ignore.
 */
export function withLevel(grid: AccessMap, section: Section, level: AccessLevel): AccessMap {
  const next = { ...grid, [section]: level };
  if (section === "integrations" && level < 2) {
    for (const k of NEEDS_INTEGRATIONS) next[k] = 0;
  }
  return next;
}

/** True when this radio is locked because Integrations is below Edit. */
export function needsIntegrations(grid: AccessMap, section: Section, level: AccessLevel): boolean {
  return NEEDS_INTEGRATIONS.includes(section) && level >= 2 && grid.integrations < 2;
}
