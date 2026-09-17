import { NextRequest, NextResponse } from "next/server";
import { requireFxAccess } from "@/lib/fx/authGuard";
import { getRate } from "@/lib/fx/ecb";
import type { Currency } from "@/types";

interface RatePair {
  currency: string;
  date: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireFxAccess();
  if (auth.error) return auth.error;

  let body: { base?: Currency; pairs?: RatePair[] };
  try {
    body = (await req.json()) as { base?: Currency; pairs?: RatePair[] };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { base, pairs } = body;
  if (!base || !Array.isArray(pairs) || pairs.length === 0) {
    return NextResponse.json({ error: "base and pairs are required" }, { status: 400 });
  }

  const rates: Record<string, { rate: number; rateDate: string }> = {};
  const unresolved: string[] = [];

  await Promise.all(
    pairs.map(async ({ currency, date }) => {
      const key = `${currency}:${date}`;
      try {
        const resolved = await getRate(currency, date, base);
        if (resolved) {
          rates[key] = resolved;
        } else {
          unresolved.push(key);
        }
      } catch (err) {
        console.error(`FX rate lookup failed for ${key}`, err);
        unresolved.push(key);
      }
    })
  );

  return NextResponse.json({ rates, unresolved });
}
