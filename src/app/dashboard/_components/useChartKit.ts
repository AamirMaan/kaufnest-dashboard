"use client";

import { useMemo } from "react";
import { useTheme } from "@/components/ui/ThemeProvider";
import { formatCurrency } from "@/lib/utils/currency";
import type { Currency } from "@/types";
import { chartTheme, compactMoney, type ChartTheme } from "../_lib/chartPalette";

export interface ChartKit {
  colors: ChartTheme;
  /** Spread onto every recharts <XAxis>/<YAxis>. */
  axis: {
    tick: { fontSize: number; fill: string };
    axisLine: false;
    tickLine: false;
  };
  tooltip: {
    contentStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
  };
  legend: { iconType: "circle"; iconSize: number; wrapperStyle: React.CSSProperties };
  money: (value: number) => string;
  compact: (value: number) => string;
}

/** Theme-aware chart props shared by the Overview cards. */
export function useChartKit(currency: Currency): ChartKit {
  const { theme } = useTheme();
  return useMemo(() => {
    const colors = chartTheme(theme === "dark");
    return {
      colors,
      axis: { tick: { fontSize: 11, fill: colors.tick }, axisLine: false, tickLine: false },
      tooltip: {
        contentStyle: {
          background: colors.tooltipBg,
          border: `1px solid ${colors.tooltipBorder}`,
          borderRadius: "0.5rem",
          fontSize: "12px",
        },
        labelStyle: { color: colors.tooltipLabel, marginBottom: 4, fontWeight: 600 },
      },
      legend: { iconType: "circle", iconSize: 7, wrapperStyle: { fontSize: 12, paddingTop: 6, color: colors.tick } },
      money: (value: number) => formatCurrency(value, currency),
      compact: (value: number) => compactMoney(value, currency),
    };
  }, [theme, currency]);
}
