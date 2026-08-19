import { httpText, httpJson } from "./providers/http";
import { DEMO_ASSETS } from "./demo-roster";
import { AssetQuote, PricePoint } from "./types";

/**
 * Price history for the asset-level view.
 *
 * Three sources, tried in order and controlled by PRICE_DATA_SOURCE:
 *
 *   stooq     - free daily CSV, no key, no registration (default when live)
 *   yahoo     - Yahoo Finance chart JSON, no key but undocumented/unstable
 *   synthetic - deterministic simulated series (default, zero setup)
 *
 * A failure never breaks the page. In auto/simulated modes we fall back to the
 * synthetic series and flag `isLive: false` so the UI labels it clearly; in
 * strict live mode (production default) we return no data instead — see
 * getPriceHistory's `allowSynthetic` option.
 */

export type PriceSourceKind = "synthetic" | "stooq" | "yahoo";

/**
 * Default price source: synthetic in development (zero setup), stooq in
 * production/deployment so a published page shows real market prices, not
 * placeholders. Override with PRICE_DATA_SOURCE.
 */
export function configuredPriceSource(): PriceSourceKind {
  const raw = (process.env.PRICE_DATA_SOURCE ?? "").toLowerCase();
  if (raw === "stooq" || raw === "yahoo" || raw === "synthetic") return raw;
  return process.env.NODE_ENV === "production" ? "stooq" : "synthetic";
}

/**
 * ~15 months of weekdays. Deliberately longer than a calendar year so the "1Y"
 * performance window has a data point at or before its cutoff — 260 weekdays is
 * only ~364 calendar days, which leaves 1Y unanswerable.
 */
const TRADING_DAYS = 320;

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function referencePriceFor(ticker: string): number {
  const known = DEMO_ASSETS.find((a) => a.ticker === ticker && a.referencePrice);
  if (known?.referencePrice) return known.referencePrice;
  // Deterministic but plausible price for anything not in the demo universe.
  const r = rng(hashString(ticker));
  return Math.round((15 + r() * 400) * 100) / 100;
}

/** Weekdays only — markets are closed at weekends, so the x-axis shouldn't lie. */
function tradingDates(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

/**
 * Deterministic synthetic history: a seeded random walk with mild drift, ending
 * at the ticker's reference price. Stable for a given ticker and day.
 */
export function syntheticHistory(ticker: string, days = TRADING_DAYS): PricePoint[] {
  const dates = tradingDates(days);
  const end = referencePriceFor(ticker);
  const r = rng(hashString(`${ticker}:hist`));

  // Build backwards from today's reference price so the latest point is anchored.
  const closes: number[] = [end];
  const dailyVol = 0.008 + r() * 0.022;
  const drift = (r() - 0.42) * 0.0016;

  for (let i = 1; i < dates.length; i++) {
    const prev = closes[i - 1]!;
    const shock = (r() - 0.5) * 2 * dailyVol;
    const next = prev / (1 + drift + shock);
    closes.push(Math.max(0.5, next));
  }
  closes.reverse();

  return dates.map((date, i) => ({
    date,
    close: Math.round(closes[i]! * 100) / 100,
  }));
}

/** Stooq daily CSV: Date,Open,High,Low,Close,Volume. */
async function fetchStooqHistory(ticker: string): Promise<PricePoint[]> {
  const symbol = `${ticker.toLowerCase().replace(/\./g, "-")}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const csv = await httpText(url, { timeoutMs: 20_000 });

  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2 || !/date/i.test(lines[0] ?? "")) {
    throw new Error(`stooq returned no data for ${ticker}`);
  }

  const points: PricePoint[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[0];
    const close = Number(cols[4]);
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    points.push({ date, close });
  }

  if (points.length === 0) throw new Error(`stooq returned no parseable rows for ${ticker}`);
  return points.slice(-TRADING_DAYS);
}

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: unknown;
  };
}

async function fetchYahooHistory(ticker: string): Promise<PricePoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const payload = await httpJson<YahooChart>(url, { timeoutMs: 20_000 });

  const result = payload.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  if (stamps.length === 0) throw new Error(`Yahoo returned no data for ${ticker}`);

  const points: PricePoint[] = [];
  stamps.forEach((ts, i) => {
    const close = closes[i];
    if (typeof close !== "number" || !Number.isFinite(close)) return;
    points.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: Math.round(close * 100) / 100 });
  });

  if (points.length === 0) throw new Error(`Yahoo returned no parseable closes for ${ticker}`);
  return points.slice(-TRADING_DAYS);
}

export interface PriceResult {
  history: PricePoint[];
  /** Absent when no price data is available (strict live mode, upstream down). */
  quote?: AssetQuote;
  isLive: boolean;
  warning?: string;
}

function quoteFrom(ticker: string, name: string, history: PricePoint[], isLive: boolean): AssetQuote {
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const price = last?.close ?? 0;
  const previousClose = prev?.close ?? price;
  const change = price - previousClose;

  return {
    ticker,
    name,
    price,
    previousClose,
    change: Math.round(change * 100) / 100,
    changePct: previousClose > 0 ? (change / previousClose) * 100 : 0,
    currency: "USD",
    isLive,
    asOf: last?.date ?? new Date().toISOString().slice(0, 10),
  };
}

/**
 * Fetch price history for one ticker.
 *
 * `allowSynthetic` controls the failure path: when true (demo/auto contexts) a
 * dead upstream falls back to the labelled synthetic series; when false (strict
 * live mode) it returns NO data instead — a published live page must never show
 * placeholder prices, even flagged ones.
 */
export async function getPriceHistory(
  ticker: string,
  name: string,
  { allowSynthetic = true }: { allowSynthetic?: boolean } = {},
): Promise<PriceResult> {
  const source = configuredPriceSource();

  if (source !== "synthetic") {
    try {
      const history =
        source === "stooq" ? await fetchStooqHistory(ticker) : await fetchYahooHistory(ticker);
      return { history, quote: quoteFrom(ticker, name, history, true), isLive: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!allowSynthetic) {
        return { history: [], isLive: false, warning: `No live price data: ${message}` };
      }
      const history = syntheticHistory(ticker);
      return {
        history,
        quote: quoteFrom(ticker, name, history, false),
        isLive: false,
        warning: `Simulated prices: ${message}`,
      };
    }
  }

  if (!allowSynthetic) {
    return {
      history: [],
      isLive: false,
      warning: "PRICE_DATA_SOURCE=synthetic is disabled in live mode — set stooq or yahoo",
    };
  }

  const history = syntheticHistory(ticker);
  return { history, quote: quoteFrom(ticker, name, history, false), isLive: false };
}
