import { httpJson } from "./http";
import { mapLooseTrades } from "./loose";
import { Trade } from "../types";

/**
 * Commercial aggregator providers.
 *
 * These sit behind API keys and do the expensive part — extracting transaction
 * rows out of House PTR PDFs — so they are the practical way to get
 * ticker-level House data. Each is enabled purely by the presence of its key.
 *
 * Endpoint paths are overridable via env because these are commercial APIs whose
 * routes and plan gating change; if a vendor moves a path, point the env var at
 * the new one instead of waiting on a code change. Response parsing goes through
 * the tolerant mapper in `loose.ts`.
 */

export interface AggregatorConfig {
  id: "quiver" | "unusual-whales" | "fmp" | "finnhub" | "congressinvests" | "lambda";
  label: string;
  docsUrl: string;
  /** Env var holding the credential. */
  keyEnv: string;
  configured: boolean;
}

export const AGGREGATORS: AggregatorConfig[] = [
  {
    id: "quiver",
    label: "Quiver Quantitative",
    docsUrl: "https://www.quiverquant.com/api/",
    keyEnv: "QUIVER_API_KEY",
    configured: Boolean(process.env.QUIVER_API_KEY),
  },
  {
    id: "unusual-whales",
    label: "Unusual Whales",
    docsUrl: "https://api.unusualwhales.com/docs",
    keyEnv: "UNUSUAL_WHALES_API_KEY",
    configured: Boolean(process.env.UNUSUAL_WHALES_API_KEY),
  },
  {
    id: "fmp",
    label: "Financial Modeling Prep",
    docsUrl: "https://site.financialmodelingprep.com/developer/docs",
    keyEnv: "FMP_API_KEY",
    configured: Boolean(process.env.FMP_API_KEY),
  },
  {
    id: "finnhub",
    label: "Finnhub",
    docsUrl: "https://finnhub.io/docs/api/congressional-trading",
    keyEnv: "FINNHUB_API_KEY",
    configured: Boolean(process.env.FINNHUB_API_KEY),
  },
  {
    id: "congressinvests",
    label: "CongressInvests",
    docsUrl: "https://congressinvests.com",
    keyEnv: "CONGRESSINVESTS_API_KEY",
    configured: Boolean(process.env.CONGRESSINVESTS_API_KEY),
  },
  {
    id: "lambda",
    label: "Lambda Finance",
    docsUrl: "https://www.lambdafin.com",
    keyEnv: "LAMBDA_API_KEY",
    configured: Boolean(process.env.LAMBDA_API_KEY),
  },
];

/** Quiver Quantitative — bulk congressional trading feed. */
export async function fetchQuiverTrades(): Promise<Trade[]> {
  const key = process.env.QUIVER_API_KEY;
  if (!key) throw new Error("QUIVER_API_KEY is not set");
  const url =
    process.env.QUIVER_CONGRESS_URL ?? "https://api.quiverquant.com/beta/bulk/congresstrading";

  const payload = await httpJson<unknown>(url, {
    headers: { Authorization: `Bearer ${key}` },
    timeoutMs: 40_000,
  });
  return mapLooseTrades(payload, { source: "quiver" });
}

/** Unusual Whales — congress trade feed. */
export async function fetchUnusualWhalesTrades(): Promise<Trade[]> {
  const key = process.env.UNUSUAL_WHALES_API_KEY;
  if (!key) throw new Error("UNUSUAL_WHALES_API_KEY is not set");
  const url =
    process.env.UNUSUAL_WHALES_CONGRESS_URL ??
    "https://api.unusualwhales.com/api/congress/recent-trades?limit=500";

  const payload = await httpJson<unknown>(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    timeoutMs: 40_000,
  });
  return mapLooseTrades(payload, { source: "unusual-whales" });
}

/**
 * Financial Modeling Prep — separate Senate and House feeds. Both are paged; we
 * pull the first few pages, which covers recent activity.
 */
export async function fetchFmpTrades(pages = 3): Promise<Trade[]> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set");

  const bases = [
    process.env.FMP_SENATE_URL ?? "https://financialmodelingprep.com/api/v4/senate-trading-rss-feed",
    process.env.FMP_HOUSE_URL ?? "https://financialmodelingprep.com/api/v4/senate-disclosure-rss-feed",
  ];

  const requests: Array<Promise<unknown>> = [];
  for (const base of bases) {
    for (let page = 0; page < pages; page++) {
      const url = `${base}${base.includes("?") ? "&" : "?"}page=${page}&apikey=${encodeURIComponent(key)}`;
      requests.push(httpJson<unknown>(url, { timeoutMs: 30_000 }));
    }
  }

  const settled = await Promise.allSettled(requests);
  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<unknown> => r.status === "fulfilled",
  );
  if (fulfilled.length === 0) {
    throw new Error("all FMP requests failed");
  }

  const defaultChamber = "senate" as const;
  return fulfilled.flatMap((r) => mapLooseTrades(r.value, { source: "fmp", defaultChamber }));
}

/**
 * Finnhub's congressional-trading endpoint is **symbol-scoped**, so it can't
 * produce a global feed on its own — it needs a watchlist to iterate. That makes
 * it a good enrichment source for specific tickers rather than a primary feed.
 */
export async function fetchFinnhubTrades(symbols: string[]): Promise<Trade[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set");
  if (symbols.length === 0) return [];

  const base = process.env.FINNHUB_CONGRESS_URL ?? "https://finnhub.io/api/v1/stock/congressional-trading";

  const settled = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const url = `${base}?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
      const payload = await httpJson<unknown>(url, { timeoutMs: 20_000 });
      // Finnhub nests rows under `data` and omits the symbol on each row, so
      // stamp it back on before mapping.
      const rows = Array.isArray((payload as { data?: unknown[] })?.data)
        ? ((payload as { data: Record<string, unknown>[] }).data ?? [])
        : [];
      return rows.map((row): Record<string, unknown> => ({ symbol, ...row }));
    }),
  );

  const rows = settled
    .filter((r): r is PromiseFulfilledResult<Record<string, unknown>[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  if (rows.length === 0 && settled.every((r) => r.status === "rejected")) {
    throw new Error("all Finnhub symbol requests failed");
  }
  return mapLooseTrades(rows, { source: "finnhub" });
}

/** CongressInvests — REST feed. Base URL is configurable; plans differ. */
export async function fetchCongressInvestsTrades(): Promise<Trade[]> {
  const key = process.env.CONGRESSINVESTS_API_KEY;
  if (!key) throw new Error("CONGRESSINVESTS_API_KEY is not set");
  const url = process.env.CONGRESSINVESTS_URL ?? "https://api.congressinvests.com/v1/trades?limit=500";

  const payload = await httpJson<unknown>(url, {
    headers: { Authorization: `Bearer ${key}`, "X-API-Key": key },
    timeoutMs: 30_000,
  });
  return mapLooseTrades(payload, { source: "congressinvests" });
}

/** Lambda Finance — dual-chamber API. */
export async function fetchLambdaTrades(): Promise<Trade[]> {
  const key = process.env.LAMBDA_API_KEY;
  if (!key) throw new Error("LAMBDA_API_KEY is not set");
  const url = process.env.LAMBDA_CONGRESS_URL ?? "https://api.lambdafin.com/v1/trades?limit=500";

  const payload = await httpJson<unknown>(url, {
    headers: { Authorization: `Bearer ${key}`, "X-API-Key": key },
    timeoutMs: 30_000,
  });
  return mapLooseTrades(payload, { source: "lambda" });
}
