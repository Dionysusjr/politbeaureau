import { AMOUNT_BRACKETS, bracketMidpoint } from "../amounts";
import { DEMO_ASSETS, DEMO_FILERS, DemoAsset, DemoFilerWithId } from "../demo-roster";
import { daysBetween, tradeKey } from "../normalize";
import { Trade, TradeType } from "../types";

/**
 * Built-in simulator — the zero-setup data source.
 *
 * Two layers, both deterministic:
 *
 *  1. A **historical corpus** anchored to today's UTC date, so the same
 *     dashboard state is produced on every request within a day rather than
 *     reshuffling on each 30s poll.
 *  2. A **live tape** keyed to fixed wall-clock buckets, so new "just disclosed"
 *     filings genuinely appear over time and the auto-refresh has something real
 *     to show. Within a bucket the output is identical, so refreshes are stable.
 *
 * Filers are fictional (see demo-roster.ts for why). Transactions are invented.
 */

const LOOKBACK_DAYS = 540;
/** A new simulated disclosure lands every 45s. */
const LIVE_BUCKET_MS = 45_000;
/** How many recent buckets stay on the tape. */
const LIVE_TAPE_SIZE = 40;

/** mulberry32 — small, fast, good enough for reproducible synthetic data. */
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

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickWeighted<T extends { weight: number }>(items: T[], r: number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let acc = r * total;
  for (const item of items) {
    acc -= item.weight;
    if (acc <= 0) return item;
  }
  return items[items.length - 1]!;
}

/**
 * Target estimated portfolio for a filer, in USD. The roster weight maps
 * linearly onto this so the tier bands are hit predictably:
 * weight 62 -> $6.2M (mega), 27 -> $2.7M (large), 9.5 -> $950K (medium),
 * 2.1 -> $210K (small).
 */
function targetPortfolio(filer: DemoFilerWithId): number {
  return filer.weight * 100_000;
}

/** Bigger portfolios are built from more, larger transactions. */
function tradeCountFor(filer: DemoFilerWithId): number {
  const n = Math.round(4 + 4.2 * Math.log10(filer.weight * 10 + 1));
  return Math.max(3, Math.min(48, n));
}

/** Nearest disclosure bracket to a target per-trade size. */
function bracketNear(target: number, jitter: number) {
  let bestIdx = 0;
  let bestDist = Infinity;
  AMOUNT_BRACKETS.forEach((b, i) => {
    const mid = bracketMidpoint(b.min, b.max);
    const dist = Math.abs(Math.log(mid + 1) - Math.log(target + 1));
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  });
  // +/- one bracket of spread so a profile isn't a single repeated value.
  const shift = jitter < 0.25 ? -1 : jitter > 0.8 ? 1 : 0;
  const idx = Math.max(0, Math.min(AMOUNT_BRACKETS.length - 1, bestIdx + shift));
  return AMOUNT_BRACKETS[idx]!;
}

function assetsFor(filer: DemoFilerWithId): DemoAsset[] {
  // Bias the filer's universe toward their preferred classes without excluding
  // the rest, so profiles read as distinct but still overlap on popular names.
  return DEMO_ASSETS.map((a) => ({
    ...a,
    weight: filer.bias.includes(a.assetClass) ? a.weight * 3.5 : a.weight * 0.5,
  }));
}

function isoDay(offsetDaysFromToday: number): string {
  const anchor = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  return new Date(anchor - offsetDaysFromToday * 86_400_000).toISOString().slice(0, 10);
}

function makeTrade(params: {
  filer: DemoFilerWithId;
  asset: DemoAsset;
  type: TradeType;
  transactionDate: string;
  disclosureDate: string;
  amountTarget: number;
  r: () => number;
}): Trade {
  const { filer, asset, type, transactionDate, disclosureDate, amountTarget, r } = params;
  const bracket = bracketNear(amountTarget, r());
  const amountMid = bracketMidpoint(bracket.min, bracket.max);

  const ownerRoll = r();
  const owner = ownerRoll < 0.62 ? "self" : ownerRoll < 0.85 ? "spouse" : ownerRoll < 0.95 ? "joint" : "dependent";

  const base = {
    politicianId: filer.id,
    ticker: asset.ticker,
    assetName: asset.name,
    transactionDate,
    type,
    amountMin: bracket.min,
  };

  return {
    id: tradeKey({ ...base, assetName: asset.name }),
    politicianId: filer.id,
    politicianName: filer.name,
    chamber: filer.chamber,
    party: filer.party,
    state: filer.state,
    ticker: asset.ticker,
    assetName: asset.name,
    assetClass: asset.assetClass,
    type,
    owner,
    transactionDate,
    disclosureDate,
    filingDelayDays: daysBetween(transactionDate, disclosureDate),
    amountMin: bracket.min,
    amountMax: bracket.max,
    amountMid,
    amountRange: bracket.label,
    source: "simulated",
    capitalGainsOver200: type !== "purchase" ? r() > 0.55 : false,
    comment: r() > 0.93 ? "Held in a managed account; filer reports no trading discretion." : undefined,
  };
}

/** The stable historical corpus. */
function historicalTrades(): Trade[] {
  const trades: Trade[] = [];

  for (const filer of DEMO_FILERS) {
    const universe = assetsFor(filer);
    const count = tradeCountFor(filer);
    const target = targetPortfolio(filer);
    // ~30% of transactions are sales, which subtract from the estimated
    // portfolio, so gross buying is scaled up to still land on `target`.
    const buyShare = 0.7;
    const perTrade = target / (count * buyShare * 0.62);

    const r = rng(hashString(filer.id));
    const owned: DemoAsset[] = [];

    for (let i = 0; i < count; i++) {
      const wantSale = i > 2 && r() < 0.3 && owned.length > 0;
      const asset = wantSale
        ? owned[Math.floor(r() * owned.length)]!
        : pickWeighted(universe, r());
      if (!wantSale) owned.push(asset);

      const type: TradeType = wantSale ? (r() < 0.35 ? "partial_sale" : "sale") : "purchase";

      // Spread transactions across the lookback window, newest-biased.
      const dayOffset = Math.floor(Math.pow(r(), 1.6) * LOOKBACK_DAYS) + 2;
      const transactionDate = isoDay(dayOffset);
      // STOCK Act allows up to 45 days; most filings land inside that, some late.
      const delay = Math.max(1, Math.round(3 + Math.pow(r(), 2) * 55));
      const disclosureDate = isoDay(Math.max(0, dayOffset - delay));

      const sizeMultiplier = wantSale ? 0.75 : 1;
      trades.push(
        makeTrade({
          filer,
          asset,
          type,
          transactionDate,
          disclosureDate,
          amountTarget: perTrade * sizeMultiplier * (0.55 + r() * 0.9),
          r,
        }),
      );
    }
  }

  return trades;
}

/**
 * The live tape: one synthetic disclosure per 45s bucket. Bucket indices are
 * absolute wall-clock, so output is stable inside a bucket and grows over time.
 */
function liveTapeTrades(now: number): Trade[] {
  const currentBucket = Math.floor(now / LIVE_BUCKET_MS);
  const trades: Trade[] = [];

  for (let k = 0; k < LIVE_TAPE_SIZE; k++) {
    const bucket = currentBucket - k;
    const r = rng(bucket >>> 0);

    const filer = pickWeighted(
      DEMO_FILERS.map((f) => ({ ...f, weight: f.weight + 4 })),
      r(),
    );
    const asset = pickWeighted(assetsFor(filer), r());
    const type: TradeType = r() < 0.62 ? "purchase" : r() < 0.85 ? "sale" : "partial_sale";

    const disclosureTs = bucket * LIVE_BUCKET_MS;
    const disclosureDate = new Date(disclosureTs).toISOString().slice(0, 10);
    const txLagDays = Math.max(1, Math.round(2 + Math.pow(r(), 2) * 40));
    const transactionDate = new Date(disclosureTs - txLagDays * 86_400_000).toISOString().slice(0, 10);

    const perTrade = targetPortfolio(filer) / (tradeCountFor(filer) * 0.7 * 0.62);

    const trade = makeTrade({
      filer,
      asset,
      type,
      transactionDate,
      disclosureDate,
      amountTarget: perTrade * (0.5 + r()),
      r,
    });

    // Keep tape entries distinct from corpus entries that happen to collide on
    // the natural dedupe key, and expose the exact arrival time for the UI.
    trades.push({ ...trade, id: `${trade.id}|tape:${bucket}`, comment: trade.comment });
  }

  return trades;
}

export function getSimulatedTrades(now: number = Date.now()): Trade[] {
  const all = [...historicalTrades(), ...liveTapeTrades(now)];
  // Newest disclosure first — the order the dashboard wants.
  all.sort((a, b) => b.disclosureDate.localeCompare(a.disclosureDate));
  return all;
}
