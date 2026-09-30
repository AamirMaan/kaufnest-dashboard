import {
  balanceBars,
  bestWorstMonth,
  changeTone,
  formatPct,
  margin,
  monthLabel,
  netProfitSeries,
  pctChange,
  returnRate,
  stackedSeries,
  sumMonths,
  topCategoryShare,
} from "./overviewCharts";
import type { OverviewMonth } from "./overviewTypes";

function month(partial: Partial<OverviewMonth> & { month: string }): OverviewMonth {
  return {
    revenue_by_platform: {},
    orders: 0,
    returned_cancelled: 0,
    fees: 0,
    expenses_by_category: {},
    expenses: 0,
    purchases: 0,
    units: 0,
    vat_collected: 0,
    vat_paid: 0,
    ...partial,
  };
}

describe("pctChange", () => {
  it("returns the relative change in percent", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
  });

  it("is null when there is nothing to compare against", () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(100, null)).toBeNull();
    expect(pctChange(100, undefined)).toBeNull();
  });

  it("uses the magnitude of a negative previous value", () => {
    // -100 → -50 is an improvement, not a 50% drop
    expect(pctChange(-50, -100)).toBe(50);
  });
});

describe("changeTone", () => {
  it("maps direction to good/bad per metric", () => {
    expect(changeTone(10, "up")).toBe("good");
    expect(changeTone(-10, "up")).toBe("bad");
    expect(changeTone(10, "down")).toBe("bad");
    expect(changeTone(-10, "down")).toBe("good");
  });

  it("is neutral for zero or missing", () => {
    expect(changeTone(0, "up")).toBe("neutral");
    expect(changeTone(null, "down")).toBe("neutral");
  });
});

describe("formatPct", () => {
  it("signs and rounds to one decimal", () => {
    expect(formatPct(12.345)).toBe("+12.3%");
    expect(formatPct(-4)).toBe("−4.0%");
    expect(formatPct(0)).toBe("0.0%");
  });
});

describe("margin", () => {
  it("is profit over revenue in percent", () => {
    expect(margin(25, 100)).toBe(25);
    expect(margin(-10, 50)).toBe(-20);
  });

  it("is null without positive revenue", () => {
    expect(margin(10, 0)).toBeNull();
    expect(margin(10, -5)).toBeNull();
  });
});

describe("monthLabel", () => {
  it("formats YYYY-MM as a short English label", () => {
    expect(monthLabel("2026-01")).toBe("Jan 26");
    expect(monthLabel("1999-12")).toBe("Dec 99");
  });

  it("returns the input when it is not a month key", () => {
    expect(monthLabel("garbage")).toBe("garbage");
  });
});

describe("sumMonths", () => {
  it("adds one numeric field across months", () => {
    const months = [month({ month: "2026-01", orders: 2 }), month({ month: "2026-02", orders: 3 })];
    expect(sumMonths(months, "orders")).toBe(5);
    expect(sumMonths([], "units")).toBe(0);
  });
});

describe("stackedSeries", () => {
  it("orders keys by period total and zero-fills every row", () => {
    const months = [
      month({ month: "2026-01", revenue_by_platform: { ebay: 10, amazon: 50 } }),
      month({ month: "2026-02", revenue_by_platform: { ebay: 70 } }),
      month({ month: "2026-03" }),
    ];
    expect(stackedSeries(months, "revenue_by_platform")).toEqual({
      keys: ["ebay", "amazon"],
      rows: [
        { label: "Jan 26", values: { ebay: 10, amazon: 50 } },
        { label: "Feb 26", values: { ebay: 70, amazon: 0 } },
        { label: "Mar 26", values: { ebay: 0, amazon: 0 } },
      ],
    });
  });

  it("breaks total ties by name", () => {
    const months = [month({ month: "2026-01", expenses_by_category: { tax: 5, office: 5 } })];
    expect(stackedSeries(months, "expenses_by_category").keys).toEqual(["office", "tax"]);
  });

  it("is empty for no months", () => {
    expect(stackedSeries([], "expenses_by_category")).toEqual({ keys: [], rows: [] });
  });
});

describe("netProfitSeries", () => {
  it("subtracts fees, expenses and purchases from revenue per month", () => {
    const months = [
      month({ month: "2026-01", revenue_by_platform: { ebay: 100, amazon: 50 }, fees: 10, expenses: 20, purchases: 30 }),
      month({ month: "2026-02", expenses: -15 }),
    ];
    expect(netProfitSeries(months)).toEqual([
      { label: "Jan 26", value: 90 },
      { label: "Feb 26", value: 15 },
    ]);
  });
});

describe("bestWorstMonth", () => {
  it("finds the highest and lowest points, first wins ties", () => {
    const series = [
      { label: "Jan", value: 5 },
      { label: "Feb", value: 9 },
      { label: "Mar", value: 9 },
      { label: "Apr", value: -2 },
    ];
    expect(bestWorstMonth(series)).toEqual({
      best: { label: "Feb", value: 9 },
      worst: { label: "Apr", value: -2 },
    });
  });

  it("is null with fewer than two points", () => {
    expect(bestWorstMonth([])).toBeNull();
    expect(bestWorstMonth([{ label: "Jan", value: 1 }])).toBeNull();
  });
});

describe("topCategoryShare", () => {
  it("returns the largest category and its share of the total", () => {
    expect(
      topCategoryShare(
        [
          { category: "office", amount: 20 },
          { category: "shipping", amount: 60 },
        ],
        80
      )
    ).toEqual({ category: "shipping", amount: 60, share: 75 });
  });

  it("is null when empty or the total is not positive", () => {
    expect(topCategoryShare([], 10)).toBeNull();
    expect(topCategoryShare([{ category: "tax", amount: -5 }], -5)).toBeNull();
  });
});

describe("returnRate", () => {
  it("is returned/cancelled over all orders in percent", () => {
    expect(returnRate(20, 3)).toBe(15);
  });

  it("is null without orders", () => {
    expect(returnRate(0, 0)).toBeNull();
  });
});

describe("balanceBars", () => {
  it("lists sales, fees (ad + shipping + platform), expenses, transferred and pending", () => {
    expect(
      balanceBars({
        balance: 65, sales: 100, adFees: 10, shippingFees: 5, platformFees: 5, expenses: 15,
        transferred: 50, pending: 15, pendingIsRunning: false, count: 4,
      })
    ).toEqual([
      { name: "Sales", value: 100, tone: "positive" },
      { name: "Fees", value: 20, tone: "negative" },
      { name: "Expenses", value: 15, tone: "negative" },
      { name: "Transferred", value: 50, tone: "neutral" },
      { name: "Pending", value: 15, tone: "pending" },
    ]);
  });
});
