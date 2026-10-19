"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Applies `?location=<id>` (linked from DispatchBanner) to the Orders filters.
 * Isolated so page.tsx can wrap it in <Suspense> — Next requires a boundary
 * around useSearchParams.
 */
export function LocationParamSync({ onLocation }: { onLocation: (id: string) => void }) {
  const location = useSearchParams().get("location");
  useEffect(() => {
    if (location) onLocation(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run per URL value, not per callback identity
  }, [location]);
  return null;
}
