import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { fetchInsiderFilings } from "@/lib/providers/sec-form4";

export const dynamic = "force-dynamic";
// Serverless platforms default to short function timeouts; upstream disclosure
// sources are slow (the House index is a multi-MB ZIP), so allow up to 30s.
export const maxDuration = 30;

/**
 * SEC Form 4 corporate-insider filings for a ticker. Fetched lazily (only when
 * an asset page asks) and cached for an hour, since EDGAR is rate-limited and
 * Form 4 filings arrive on a daily cadence, not a 30-second one.
 */
export async function GET(_request: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();

  if (process.env.ENABLE_SEC_FORM4 === "false") {
    return NextResponse.json(
      { ticker, filings: [], disabled: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const filings = await cached(
      `sec:form4:${ticker}`,
      () => fetchInsiderFilings(ticker),
      { ttlMs: 60 * 60 * 1000 },
    );
    return NextResponse.json({ ticker, filings }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A missing insider feed is not a page-level failure — report it inline.
    return NextResponse.json(
      { ticker, filings: [], warning: message },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
