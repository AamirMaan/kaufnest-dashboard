"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { SECTIONS, type Section } from "@/lib/permissions/sections";

function DeniedAccessToastInner() {
  const { error: toastError } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const denied = searchParams.get("denied") as Section | null;
    if (!denied) return;
    const label = SECTIONS.find((s) => s.key === denied)?.label ?? denied;
    toastError("No access", `You don't have access to ${label}.`);
    // Strip the query from wherever proxy.ts landed the request — not
    // hard-coded "/dashboard" — so the toast fires once per redirect
    // regardless of which dashboard page it lands on.
    router.replace(pathname);
  }, [searchParams, pathname, toastError, router]);

  return null;
}

/**
 * Shows a "No access" toast when `proxy.ts`'s section guard
 * (`deniedRedirect` in `@/lib/permissions/sections`) redirects here with
 * `?denied=<section>`. Rendered once by `DashboardShell` so it fires on
 * every dashboard page the redirect can land on, not just Home.
 */
export function DeniedAccessToast() {
  return (
    <Suspense fallback={null}>
      <DeniedAccessToastInner />
    </Suspense>
  );
}
