import { cached } from "./cache";
import { buildAssetTraders, buildHoldings, computePerformance, findAsset } from "./aggregate";
import { assembleSnapshot, collectRawData, configuredMode, RawData } from "./providers";
import { configuredPriceSource, getPriceHistory, PriceResult } from "./prices";
import { AssetDetail, PoliticianDetail, PortfolioTier, Snapshot } from "./types";

/**
 * Service layer between the API routes and the providers.
 *
 * Only the IO step is cached (`collectRawData`), so a 30s browser poll doesn't
 * become a 30s upstream refresh — see cache.ts for why that matters with metered,
 * slow government endpoints. Aggregation runs per request on the cached records,
 * which is cheap and keeps every view mutually consistent.
 */

const RAW_KEY = "congress:raw";

function snapshotTtlMs(): number {
  const configured = Number(process.env.SNAPSHOT_TTL_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  // Live sources are slow and metered; the simulator is free, and a short TTL
  // there lets the simulated live tape advance between polls.
  return configuredMode() === "simulated" ? 10_000 : 300_000;
}

function getRaw(): Promise<RawData> {
  return cached(RAW_KEY, collectRawData, { ttlMs: snapshotTtlMs() });
}

export async function getSnapshot(): Promise<Snapshot> {
  return assembleSnapshot(await getRaw());
}

export async function getPoliticianDetail(id: string): Promise<PoliticianDetail | null> {
  const raw = await getRaw();
  const snapshot = assembleSnapshot(raw);

  const summary = snapshot.politicians.find((p) => p.id === id);
  if (!summary) return null;

  const trades = raw.trades
    .filter((t) => t.politicianId === id)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  return { ...summary, trades, holdings: buildHoldings(trades) };
}

export async function getAssetDetail(idOrTicker: string): Promise<AssetDetail | null> {
  const raw = await getRaw();
  const snapshot = assembleSnapshot(raw);

  const summary = findAsset(snapshot.assets, idOrTicker);
  if (!summary) return null;

  const trades = raw.trades
    .filter((t) =>
      summary.ticker ? t.ticker === summary.ticker : !t.ticker && t.assetName === summary.name,
    )
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  // Price history only exists for listed tickers. Funds, municipal bonds and
  // untickered assets get the disclosure view without a price chart.
  // In strict live mode the synthetic fallback is disabled: a published page
  // shows no chart rather than placeholder prices. Cached per ticker so a
  // public page doesn't hit the price upstream on every request.
  const allowSynthetic = configuredMode() !== "live";
  const priced: PriceResult | null = summary.ticker
    ? await cached(
        `price:${configuredPriceSource()}:${allowSynthetic}:${summary.ticker}`,
        () => getPriceHistory(summary.ticker!, summary.name, { allowSynthetic }),
        { ttlMs: 10 * 60 * 1000 },
      )
    : null;
  const history = priced?.history ?? [];

  const tierById = new Map<string, PortfolioTier>(snapshot.politicians.map((p) => [p.id, p.tier]));

  return {
    ...summary,
    quote: priced?.quote,
    history,
    performance: computePerformance(history),
    traders: buildAssetTraders(trades, tierById, history),
    trades,
  };
}
