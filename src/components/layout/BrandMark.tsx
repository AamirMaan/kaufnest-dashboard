"use client";

import { useTheme } from "@/components/ui/ThemeProvider";

interface Props {
  size?: number;
  className?: string;
}

/**
 * The Boughtopia bag icon (see public/brand/), switched between the navy and
 * white-mono variant so it stays visible against the theme-aware
 * sidebar/header background it's paired with — same idea as the wordmark
 * text next to it already using theme CSS vars for color. Decorative only
 * (the wordmark text carries the accessible name), so alt="" + aria-hidden.
 */
export function BrandMark({ size = 22, className }: Props) {
  const { theme } = useTheme();
  const src =
    theme === "dark"
      ? "/brand/boughtopia-icon-bag-mono-light.svg"
      : "/brand/boughtopia-icon-bag.svg";

  return <img src={src} alt="" aria-hidden="true" width={size} height={size} className={className} />;
}
