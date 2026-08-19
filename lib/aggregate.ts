import { classifyTier } from "./tiers";
import { daysBetween, slugify } from "./normalize";
import {
  AssetClass,
  AssetSummary,
  AssetTrader,
  Holding,
  Politician,
  PoliticianSummary,
  PortfolioTier,
  PricePoint,
  SnapshotStats,
  Trade,
} from "./types";

/** Sales reduce a position; purchases and exchanges add to it. */
function isBuy(t: Trade): boolean {
  return t.type === "purchase" || t.type === "exchange";
}

/**
 * Grouping key for an asset. Tickered securities group by ticker — including
 * their derivatives, so a ticker's page shows every disclosed position in that
 * name. Untickered assets group on a route-safe slug of their description.
 */
function assetKey(t: { ticker?: string; assetName: string }): string {
  return t.ticker ?? `n-${slugify(t.assetName).slice(0, 48)}`;
}

/**
 * Estimated portfolio value for a filer.
 *
 * Disclosures give brackets per *transaction*, not a portfolio statement, so we
 * estimate size as net retained disclosed flow (purchases minus sales), floored
 * at zero per position — a filer who sold more than we ever saw them buy has an
 * unknown basis, not a negative portfolio. This is the figure the tier ranking
 * uses, and the UI labels it an estimate everywhere it appears.
 */
function estimatePortfolio(trades: Trade[]): { value: number; min: number; max: number } {
  const byAsset = new Map<string, { mid: number; min: number; max: number }>();

  for (const t of trades) {
    const key = assetKey(t);
    const acc = byAsset.get(key) ?? { mid: 0, min: 0, max: 0 };
    const sign = isBuy(t) ? 1 : -1;
    acc.mid += sign * t.amountMid;
    acc.min += sign * t.amountMin;
    acc.max += sign * t.amountMax;
    byAsset.set(key, acc);
  }

  let value = 0;
  let min = 0;
  let max = 0;
  for (const acc of byAsset.values()) {
    value += Math.max(0, acc.mid);
    min += Math.max(0, acc.min);
    max += Math.max(0, acc.max);
  }
  return { value: Math.round(value), min: Math.round(min), max: Math.round(max) };
}

export function buildHoldings(trades: Trade[]): Holding[] {
  const map = new Map<string, Holding>();

  for (const t of trades) {
    const key = assetKey(t);
    const existing = map.get(key);
    const holding: Holding = existing ?? {
      ticker: t.ticker,
      assetName: t.assetName,
      assetClass: t.assetClass,
      netValue: 0,
      purchaseValue: 0,
      saleValue: 0,
      tradeCount: 0,
      lastTradeDate: t.transactionDate,
    };

    if (isBuy(t)) {
      holding.purchaseValue += t.amountMid;
      holding.netValue += t.amountMid;
    } else {
      holding.saleValue += t.amountMid;
      holding.netValue -= t.amountMid;
    }
    holding.tradeCount += 1;
    if (t.transactionDate > holding.lastTradeDate) holding.lastTradeDate = t.transactionDate;

    map.set(key, holding);
  }

  return [...map.values()].sort((a, b) => b.netValue - a.netValue);
}

/**
 * Build ranked politician summaries. `roster` supplies chamber/party/state
 * metadata; filers present in the trades but missing from the roster are still
 * included, using whatever the trade record carried.
 */
export function buildPoliticians(
  trades: Trade[],
  roster: Map<string, Politician>,
): PoliticianSummary[] {
  const grouped = new Map<string, Trade[]>();
  for (const t of trades) {
    const list = grouped.get(t.politicianId);
    if (list) list.push(t);
    else grouped.set(t.politicianId, [t]);
  }

  const summaries: PoliticianSummary[] = [];

  for (const [id, list] of grouped) {
    const first = list[0]!;
    const meta = roster.get(id);
    const portfolio = estimatePortfolio(list);
    const holdings = buildHoldings(list);

    const buyValue = list.filter(isBuy).reduce((s, t) => s + t.amountMid, 0);
    const sellValue = list.filter((t) => !isBuy(t)).reduce((s, t) => s + t.amountMid, 0);

    const classTotals = new Map<AssetClass, number>();
    for (const t of list) {
      classTotals.set(t.assetClass, (classTotals.get(t.assetClass) ?? 0) + t.amountMid);
    }

    const dates = list.map((t) => t.transactionDate).sort();
    const delays = list.map((t) => t.filingDelayDays);

    summaries.push({
      id,
      name: meta?.name ?? first.politicianName,
      chamber: meta?.chamber ?? first.chamber,
      party: meta?.party ?? first.party,
      state: meta?.state ?? first.state,
      district: meta?.district,
      role: meta?.role ?? (first.chamber === "senate" ? "Senator" : "Representative"),
      committees: meta?.committees ?? [],
      portfolioValue: portfolio.value,
      portfolioValueMin: portfolio.min,
      portfolioValueMax: portfolio.max,
      tier: classifyTier(portfolio.value),
      rank: 0, // assigned after sorting
      tradeCount: list.length,
      purchaseCount: list.filter(isBuy).length,
      saleCount: list.filter((t) => !isBuy(t)).length,
      buyValue: Math.round(buyValue),
      sellValue: Math.round(sellValue),
      uniqueAssets: new Set(list.map(assetKey)).size,
      topAssets: holdings.slice(0, 5).map((h) => ({
        ticker: h.ticker,
        assetName: h.assetName,
        value: Math.round(h.netValue),
      })),
      assetClassMix: [...classTotals.entries()]
        .map(([assetClass, value]) => ({ assetClass, value: Math.round(value) }))
        .sort((a, b) => b.value - a.value),
      lastTradeDate: dates[dates.length - 1],
      avgFilingDelayDays: delays.length
        ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length)
        : 0,
    });
  }

  summaries.sort((a, b) => b.portfolioValue - a.portfolioValue || a.name.localeCompare(b.name));
  summaries.forEach((p, i) => {
    p.rank = i + 1;
  });
  return summaries;
}

/**
 * Pick the display name for an asset that several filings describe differently.
 *
 * Derivatives are reported under the underlying's ticker ("SPY put option,
 * strike $600, expires…"), so first-seen naming lets an option description
 * hijack the whole ticker. Prefer the shortest plain-security description and
 * fall back to the shortest name overall.
 */
function preferredAssetName(names: string[]): string {
  const derivative = /option|call\b|put\b|strike|expir|warrant/i;
  const plain = names.filter((n) => !derivative.test(n));
  const pool = plain.length ? plain : names;
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!;
}

export function buildAssets(trades: Trade[]): AssetSummary[] {
  const map = new Map<
    string,
    AssetSummary & {
      politicians: Set<string>;
      buyers: Set<string>;
      sellers: Set<string>;
      parties: Map<string, Set<string>>;
      names: string[];
      classCounts: Map<AssetClass, number>;
    }
  >();

  for (const t of trades) {
    const key = assetKey(t);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        id: t.ticker ?? key,
        ticker: t.ticker,
        name: t.assetName,
        assetClass: t.assetClass,
        buyValue: 0,
        sellValue: 0,
        netValue: 0,
        tradeCount: 0,
        purchaseCount: 0,
        saleCount: 0,
        politicianCount: 0,
        buyerCount: 0,
        sellerCount: 0,
        partySplit: { D: 0, R: 0, I: 0 },
        lastTradeDate: t.transactionDate,
        politicians: new Set(),
        buyers: new Set(),
        sellers: new Set(),
        parties: new Map(),
        names: [],
        classCounts: new Map(),
      };
      map.set(key, entry);
    }

    entry.names.push(t.assetName);
    entry.classCounts.set(t.assetClass, (entry.classCounts.get(t.assetClass) ?? 0) + 1);

    if (isBuy(t)) {
      entry.buyValue += t.amountMid;
      entry.netValue += t.amountMid;
      entry.purchaseCount += 1;
      entry.buyers.add(t.politicianId);
    } else {
      entry.sellValue += t.amountMid;
      entry.netValue -= t.amountMid;
      entry.saleCount += 1;
      entry.sellers.add(t.politicianId);
    }

    entry.tradeCount += 1;
    entry.politicians.add(t.politicianId);
    if (t.party === "D" || t.party === "R" || t.party === "I") {
      const set = entry.parties.get(t.party) ?? new Set<string>();
      set.add(t.politicianId);
      entry.parties.set(t.party, set);
    }
    if (t.transactionDate > entry.lastTradeDate) entry.lastTradeDate = t.transactionDate;
  }

  return [...map.values()]
    .map(({ politicians, buyers, sellers, parties, names, classCounts, ...rest }) => ({
      ...rest,
      name: preferredAssetName(names),
      assetClass:
        [...classCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? rest.assetClass,
      buyValue: Math.round(rest.buyValue),
      sellValue: Math.round(rest.sellValue),
      netValue: Math.round(rest.netValue),
      politicianCount: politicians.size,
      buyerCount: buyers.size,
      sellerCount: sellers.size,
      partySplit: {
        D: parties.get("D")?.size ?? 0,
        R: parties.get("R")?.size ?? 0,
        I: parties.get("I")?.size ?? 0,
      },
    }))
    .sort((a, b) => b.buyValue - a.buyValue);
}

/** Per-politician rollup for a single asset, used by the asset detail page. */
export function buildAssetTraders(
  trades: Trade[],
  tierById: Map<string, PortfolioTier>,
  history: PricePoint[],
): AssetTrader[] {
  const map = new Map<string, AssetTrader & { firstBuyDate?: string }>();

  for (const t of trades) {
    let entry = map.get(t.politicianId);
    if (!entry) {
      entry = {
        politicianId: t.politicianId,
        politicianName: t.politicianName,
        chamber: t.chamber,
        party: t.party,
        state: t.state,
        tier: tierById.get(t.politicianId) ?? "small",
        buyValue: 0,
        sellValue: 0,
        netValue: 0,
        tradeCount: 0,
        firstTradeDate: t.transactionDate,
        lastTradeDate: t.transactionDate,
      };
      map.set(t.politicianId, entry);
    }

    if (isBuy(t)) {
      entry.buyValue += t.amountMid;
      entry.netValue += t.amountMid;
      if (!entry.firstBuyDate || t.transactionDate < entry.firstBuyDate) {
        entry.firstBuyDate = t.transactionDate;
      }
    } else {
      entry.sellValue += t.amountMid;
      entry.netValue -= t.amountMid;
    }
    entry.tradeCount += 1;
    if (t.transactionDate < entry.firstTradeDate) entry.firstTradeDate = t.transactionDate;
    if (t.transactionDate > entry.lastTradeDate) entry.lastTradeDate = t.transactionDate;
  }

  const latest = history[history.length - 1]?.close;

  return [...map.values()]
    .map(({ firstBuyDate, ...rest }) => {
      let returnSinceFirstBuyPct: number | undefined;
      if (firstBuyDate && latest && history.length > 1) {
        // Closest close at or after the disclosed purchase date.
        const at = history.find((p) => p.date >= firstBuyDate)?.close;
        if (at && at > 0) returnSinceFirstBuyPct = ((latest - at) / at) * 100;
      }
      return {
        ...rest,
        buyValue: Math.round(rest.buyValue),
        sellValue: Math.round(rest.sellValue),
        netValue: Math.round(rest.netValue),
        returnSinceFirstBuyPct,
      };
    })
    .sort((a, b) => b.buyValue - a.buyValue);
}

export function buildStats(
  trades: Trade[],
  politicians: PoliticianSummary[],
  assets: AssetSummary[],
): SnapshotStats {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const tierCounts: Record<PortfolioTier, number> = { mega: 0, large: 0, medium: 0, small: 0 };
  for (const p of politicians) tierCounts[p.tier] += 1;

  const buyValue = trades.filter(isBuy).reduce((s, t) => s + t.amountMid, 0);
  const sellValue = trades.filter((t) => !isBuy(t)).reduce((s, t) => s + t.amountMid, 0);
  const delays = trades.map((t) => t.filingDelayDays);

  return {
    totalTrades: trades.length,
    totalDisclosedValue: Math.round(buyValue + sellValue),
    buyValue: Math.round(buyValue),
    sellValue: Math.round(sellValue),
    politicianCount: politicians.length,
    assetCount: assets.length,
    newThisWeek: trades.filter((t) => t.disclosureDate >= weekAgo && t.disclosureDate <= today).length,
    avgFilingDelayDays: delays.length
      ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length)
      : 0,
    tierCounts,
  };
}

/** Percent change over standard windows, derived from a daily close series. */
export function computePerformance(history: PricePoint[]): Array<{ label: string; changePct: number | null }> {
  const windows: Array<{ label: string; days: number }> = [
    { label: "1W", days: 7 },
    { label: "1M", days: 30 },
    { label: "3M", days: 90 },
    { label: "6M", days: 182 },
    { label: "1Y", days: 365 },
  ];

  const latest = history[history.length - 1];
  if (!latest) return windows.map((w) => ({ label: w.label, changePct: null }));

  return windows.map((w) => {
    const cutoff = new Date(Date.parse(latest.date) - w.days * 86_400_000).toISOString().slice(0, 10);
    const past = [...history].reverse().find((p) => p.date <= cutoff);
    if (!past || past.close <= 0 || past.date === latest.date) {
      return { label: w.label, changePct: null };
    }
    return { label: w.label, changePct: ((latest.close - past.close) / past.close) * 100 };
  });
}

/** Resolve an `AssetSummary.id` (ticker or name slug) back to its asset. */
export function findAsset(assets: AssetSummary[], key: string): AssetSummary | undefined {
  const raw = decodeURIComponent(key);
  return (
    assets.find((a) => a.id === raw) ??
    assets.find((a) => a.id.toUpperCase() === raw.toUpperCase()) ??
    assets.find((a) => a.ticker === raw.toUpperCase()) ??
    assets.find((a) => a.name.toLowerCase() === raw.toLowerCase())
  );
}

export { assetKey, isBuy };
