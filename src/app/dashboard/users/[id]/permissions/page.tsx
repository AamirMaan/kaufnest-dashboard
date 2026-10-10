"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Button } from "@/components/ui/Button";
import { Badge, RoleBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import {
  SECTIONS,
  LEVEL_LABELS,
  ROLE_DEFAULTS,
  planAllows,
  type AccessLevel,
  type AccessMap,
  type Section,
} from "@/lib/permissions/sections";
import { exceptionsToGrid, diffAccess, customSections, withLevel, needsIntegrations } from "../../_lib/accessDiff";
import { ChevronLeft, RefreshCw } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

const LEVELS: AccessLevel[] = [0, 1, 2, 3];

export default function UserPermissionsPage({ params }: PageProps) {
  const { id } = use(params);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const currentUserRole = useAppSelector((s) => s.currentUser.profile?.role);
  const planEnt = useAppSelector((s) => s.currentUser.planEntitlements);
  const target = useAppSelector((s) => s.users.items.find((u) => u.id === id)) ?? null;

  const [saved, setSaved] = useState<AccessMap | null>(null);
  const [edited, setEdited] = useState<AccessMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Bumped to (re)fetch the stored rows: Retry after a load error, and after
  // a failed save so saved/edited reflect what actually reached the DB.
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Load this user's stored exceptions. Bounded: at most one row per
  // section (12 sections total) for a single user — never a growth read.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!target || target.role === "super_admin") {
        if (!cancelled) setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(false);
      const supabase = await createTenantClient();
      const { data, error } = await supabase
        .from("user_section_access")
        .select("section, level")
        .eq("user_id", id);

      if (cancelled) return;

      // Never fall back to role defaults on error — that would show (and let
      // the user save over) a grid that isn't what's stored.
      if (error) {
        setSaved(null);
        setEdited(null);
        setLoadError(true);
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as { section: Section; level: AccessLevel }[];
      const grid = exceptionsToGrid(target.role, rows);
      setSaved(grid);
      setEdited(grid);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, target?.role, reloadKey]);
  // ^ intentionally omit `target` itself — only the id/role identify what to
  //   (re)fetch; re-running on every Redux update to `target` would refetch
  //   on our own optimistic updates.

  // ── Guards ─────────────────────────────────────────────────────────────

  if (currentUserRole !== "super_admin") {
    return (
      <div className="py-24 text-center text-sm text-(--color-text-muted)">
        Only the account owner can manage permissions.
      </div>
    );
  }

  if (!target) {
    return (
      <div className="py-24 text-center space-y-4">
        <p className="text-lg font-semibold text-(--color-text-strong)">User not found</p>
        <Link
          href="/dashboard/users"
          className="inline-flex items-center gap-1.5 text-sm text-(--color-primary) hover:underline"
        >
          <ChevronLeft size={14} />
          Back to Users
        </Link>
      </div>
    );
  }

  const backLink = (
    <Link
      href="/dashboard/users"
      className="inline-flex items-center gap-1.5 text-sm text-(--color-text-muted) hover:text-(--color-text-base) transition-colors"
    >
      <ChevronLeft size={16} />
      Users
    </Link>
  );

  if (target.role === "super_admin") {
    return (
      <div className="space-y-6">
        {backLink}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-(--color-text-strong)">
            {target.full_name || target.email}
          </h1>
          <RoleBadge role={target.role} />
        </div>
        <p className="text-sm text-(--color-text-muted)">
          The account owner always has full access.
        </p>
      </div>
    );
  }

  // ── Derived values (safe below the guards above — `target`/`saved`/`edited`
  // are all non-null past this point when the grid actually renders) ───────

  const customKeys = new Set(edited ? customSections(target.role, edited) : []);
  const { upserts, deletes } =
    saved && edited ? diffAccess(target.role, saved, edited) : { upserts: [], deletes: [] };
  const isDirty = upserts.length > 0 || deletes.length > 0;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !saved || !edited) return;

    setSaving(true);
    try {
      const supabase = await createTenantClient();

      if (deletes.length > 0) {
        const { error } = await supabase
          .from("user_section_access")
          .delete()
          .eq("user_id", id)
          .in("section", deletes);
        if (error) throw error;
      }

      if (upserts.length > 0) {
        const { error } = await supabase
          .from("user_section_access")
          .upsert(
            upserts.map((u) => ({ user_id: id, ...u })),
            { onConflict: "user_id,section" }
          );
        if (error) throw error;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const log = await writeAuditLog(supabase, {
        userId: user!.id,
        userEmail: user!.email ?? "",
        action: "update",
        entityType: "user",
        entityId: target.id,
        metadata: { user_access: { before: saved, after: edited } },
      });
      if (log) dispatch(addAuditLog(log));

      setSaved(edited);
      success("Permissions saved", `${target.full_name || target.email}'s access has been updated.`);
    } catch {
      toastError("Couldn't save permissions", "Please try again.");
      // A delete may have succeeded before the upsert failed — re-read so
      // the grid shows what is actually stored.
      setReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {backLink}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-(--color-text-strong)">
            {target.full_name || target.email}
          </h1>
          <RoleBadge role={target.role} />
        </div>
        <Button
          variant="secondary"
          type="button"
          onClick={() => setResetOpen(true)}
          disabled={loading || loadError || !edited}
        >
          Reset to role defaults
        </Button>
      </div>

      {loadError ? (
        <div className="space-y-3">
          <p className="text-sm text-(--color-text-muted)">
            Couldn&apos;t load this user&apos;s permissions.
          </p>
          <Button variant="secondary" type="button" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </div>
      ) : loading || !edited ? (
        <p className="text-sm text-(--color-text-muted)">Loading…</p>
      ) : (
        <form id="permissions-form" onSubmit={handleSave}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted) border-b border-(--color-border)">
                <th className="text-left py-2 pr-4">Section</th>
                {LEVELS.map((l) => (
                  <th key={l} className="text-center py-2 px-2 font-semibold">
                    {LEVEL_LABELS[l]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => {
                const planOk = planAllows(section.key, planEnt);
                const isCustom = customKeys.has(section.key);
                return (
                  <tr
                    key={section.key}
                    className={`border-b border-(--color-border) last:border-0 ${planOk ? "" : "opacity-50"}`}
                  >
                    <td className="py-3 pr-4 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-(--color-text-base)">
                          {section.label}
                        </span>
                        {!planOk && <Badge label="Not in your plan" />}
                        {planOk && isCustom && <Badge label="custom" variant="info" />}
                      </div>
                      {planOk && isCustom && (
                        <p className="text-xs text-(--color-text-muted) mt-0.5">
                          role default: {LEVEL_LABELS[ROLE_DEFAULTS[target.role][section.key]]}
                        </p>
                      )}
                      <p className="text-xs text-(--color-text-faint) mt-0.5">
                        {section.description}
                      </p>
                      {planOk && needsIntegrations(edited, section.key, 2) && (
                        <p className="text-xs text-(--color-text-muted) mt-0.5">
                          Needs Integrations: Edit
                        </p>
                      )}
                    </td>
                    {LEVELS.map((level) => (
                      <td key={level} className="text-center py-3 px-2 align-top">
                        {section.levels.includes(level) ? (
                          <input
                            type="radio"
                            name={section.key}
                            aria-label={`${section.label}: ${LEVEL_LABELS[level]}`}
                            checked={edited[section.key] === level}
                            disabled={!planOk || needsIntegrations(edited, section.key, level)}
                            onChange={() =>
                              setEdited((prev) => (prev ? withLevel(prev, section.key, level) : prev))
                            }
                            className="h-4 w-4 text-(--color-primary) focus:outline-none focus:ring-2 focus:ring-(--color-primary) disabled:opacity-50"
                          />
                        ) : (
                          <span className="text-(--color-text-faint)">─</span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </form>
      )}

      {!loading && !loadError && edited && (
        <div className="flex items-center gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={() => router.push("/dashboard/users")}>
            Cancel
          </Button>
          <Button type="submit" form="permissions-form" disabled={saving || !isDirty}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}

      <DeleteConfirmModal
        open={resetOpen}
        title="Reset to role defaults"
        description={`This resets ${target.full_name || target.email}'s permissions back to the ${target.role.replace("_", " ")} role's defaults. Save changes to apply it.`}
        confirmLabel="Reset"
        confirmingLabel="Resetting…"
        requireReason={false}
        onConfirm={async () => {
          setEdited({ ...ROLE_DEFAULTS[target.role] });
          setResetOpen(false);
        }}
        onClose={() => setResetOpen(false)}
      />
    </div>
  );
}
