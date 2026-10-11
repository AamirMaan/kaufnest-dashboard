import { isAssignablePlan, sortPlans, type Plan } from "@/lib/plans/entitlements";

/**
 * Pure: the <option>s for a tenant's plan dropdown (Add/Edit tenant modals).
 * Retired plans only appear when they are the tenant's current plan. A
 * current key missing from the catalog entirely is appended as
 * "<key> (unknown)", so the select shows what saving would actually keep.
 */
export function planOptions(
  catalog: readonly Plan[],
  currentKey: string | null
): { value: string; label: string }[] {
  const options = sortPlans(catalog)
    .filter((p) => isAssignablePlan(p, currentKey))
    .map((p) => ({
      value: p.key,
      label:
        p.kind === "trial"
          ? `Trial (${p.trialDays} days)`
          : p.visibility === "hidden"
            ? `${p.name} (hidden)`
            : p.visibility === "retired"
              ? `${p.name} (retired)`
              : p.name,
    }));
  if (currentKey && !options.some((o) => o.value === currentKey)) {
    options.push({ value: currentKey, label: `${currentKey} (unknown)` });
  }
  return options;
}
