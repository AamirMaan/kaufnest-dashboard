"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Applies `?location=<id>` (linked from DispatchBanner) to the Orders filters,
 * then strips the param (same pattern as DeniedAccessToast) so clicking the
 * same banner link again re-applies it and a reload can't resurrect a filter
 * the user has since cleared. Isolated so page.tsx can wrap it in <Suspense> —
 * Next requires a boundary around useSearchParams.
 */
export function LocationParamSync({ onLocation }: { onLocation: (id: string) => void }) {
  const location = useSearchParams().get("location");
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!location) return;
    onLocation(location);
    router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run per URL value, not per callback identity
  }, [location]);
  return null;
}
