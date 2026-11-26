import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { marketRates, rateSourceText } from "@/lib/fx-market";

// Market rates for the currency converter in the top bar: USD per 1 unit of each currency SOLU follows.
// Read from what SOLU already keeps (refreshed in the background); asked for only when the converter is opened.
export async function GET() {
  await requireUser();
  const rates: Record<string, number> = { USD: 1 };
  let newest: { source: string; quotedAt: Date } | null = null;
  let stale = false;
  try {
    // What is saved answers at once (it is refreshed behind, every 15 minutes); only an empty table waits for the market.
    let saved = await marketRates({ wait: false });
    if (saved.size === 0) saved = await marketRates({ wait: true });
    for (const [code, r] of saved) {
      if (!(r.usdPerUnit > 0)) continue;
      rates[code] = r.usdPerUnit;
      if (r.stale) stale = true;
      if (!newest || r.quotedAt > newest.quotedAt) newest = { source: r.source, quotedAt: r.quotedAt };
    }
  } catch { /* the converter says no rate is available */ }
  return NextResponse.json({ rates, source: newest ? rateSourceText(newest) : "", stale }, { headers: { "Cache-Control": "no-store" } });
}
