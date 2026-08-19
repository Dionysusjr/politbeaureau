import { buildAssets, buildPoliticians, buildStats } from "../aggregate";
import { demoRoster } from "../demo-roster";
import { Filing, Politician, Snapshot, SourceId, SourceStatus, Trade } from "../types";
import { isUsMarketOpen } from "../market-hours";
import {
  AGGREGATORS,
  fetchCongressInvestsTrades,
  fetchFmpTrades,
  fetchLambdaTrades,
  fetchQuiverTrades,
  fetchUnusualWhalesTrades,
} from "./aggregators";
import { fetchHouseFilings } from "./house-clerk";
import { fetchSenateTrades } from "./senate-efd";
import { getSimulatedTrades } from "./simulated";

/**
 * Source orchestration.
 *
 * Every source runs concurrently and independently (`Promise.allSettled`), so one
 * dead upstream degrades the dashboard rather than breaking it — each source's
 * health is reported back through `SourceStatus` and rendered in the UI.
 *
 * In `auto` mode, when no live source yields any trades we fall back to the
 * simulator and mark the snapshot `isLive: false`, so simulated data is never
 * presented as real. In strict `live` mode (the production default) the
 * simulator never runs at all — see configuredMode below.
 */

export type TradeSourceMode = "auto" | "simulated" | "live";

/**
 * Data-source mode.
 *
 *   simulated - simulator only (local demo).
 *   auto      - live sources, simulator fallback when none yields trades.
 *   live      - STRICT: live sources only, the simulator NEVER runs. An empty
 *               result renders as an honest "awaiting live data" state instead
 *               of placeholder filers.
 *
 * The default is `auto` in development and `live` in production/deployment, so
 * a published site never shows placeholder data unless explicitly configured to.
 */
export function configuredMode(): TradeSourceMode {
  const raw = (process.env.CONGRESS_DATA_SOURCE ?? "").toLowerCase();
  if (raw === "simulated" || raw === "live" || raw === "auto") return raw;
  return process.env.NODE_ENV === "production" ? "live" : "auto";
}

interface SourceOutcome {
  id: SourceId;
  label: string;
  trades: Trade[];
  filings: Filing[];
  roster: Politician[];
  ok: boolean;
  message?: string;
  needsCredentials?: boolean;
}

async function runSource(
  id: SourceId,
  label: string,
  fn: () => Promise<{ trades?: Trade[]; filings?: Filing[]; roster?: Politician[] }>,
): Promise<SourceOutcome> {
  try {
    const result = await fn();
    return {
      id,
      label,
      trades: result.trades ?? [],
      filings: result.filings ?? [],
      roster: result.roster ?? [],
      ok: true,
    };
  } catch (err) {
    return {
      id,
      label,
      trades: [],
      filings: [],
      roster: [],
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Merge trades from multiple providers, preferring the record from the most
 * authoritative source when two describe the same transaction.
 *
 * Primary sources win over aggregators because they *are* the filing; among
 * aggregators the order is arbitrary but stable, so output doesn't flip between
 * refreshes.
 */
const SOURCE_PRIORITY: SourceId[] = [
  "senate-efd",
  "house-clerk",
  "oge-integrity",
  "quiver",
  "unusual-whales",
  "fmp",
  "congressinvests",
  "lambda",
  "finnhub",
  "apify",
  "supabase",
  "sec-form4",
  "simulated",
];

function priorityOf(source: SourceId): number {
  const idx = SOURCE_PRIORITY.indexOf(source);
  return idx < 0 ? SOURCE_PRIORITY.length : idx;
}

/** Dedupe on the natural trade key, keeping the highest-priority source's row. */
export function mergeTrades(groups: Trade[][]): Trade[] {
  const byKey = new Map<string, Trade>();

  for (const group of groups) {
    for (const trade of group) {
      // The id already embeds a source prefix, so strip it to compare the
      // underlying transaction across providers.
      const key = trade.id.replace(/^[a-z-]+-/, "");
      const existing = byKey.get(key);
      if (!existing || priorityOf(trade.source) < priorityOf(existing.source)) {
        byKey.set(key, trade);
      }
    }
  }

  return [...byKey.values()].sort(
    (a, b) => b.disclosureDate.localeCompare(a.disclosureDate) || b.amountMid - a.amountMid,
  );
}

/** Which live sources are switched on, given the environment. */
function liveSourcePlan(): Array<{ id: SourceId; label: string; run: () => Promise<{ trades?: Trade[]; filings?: Filing[]; roster?: Politician[] }> }> {
  const plan: Array<{ id: SourceId; label: string; run: () => Promise<{ trades?: Trade[]; filings?: Filing[]; roster?: Politician[] }> }> = [];

  // --- Free primary sources: on unless explicitly disabled ---
  if (process.env.ENABLE_HOUSE_CLERK !== "false") {
    plan.push({
      id: "house-clerk",
      label: "House Clerk PTR index",
      run: async () => {
        const { filings, roster } = await fetchHouseFilings();
        return { filings, roster };
      },
    });
  }

  if (process.env.ENABLE_SENATE_EFD !== "false") {
    plan.push({
      id: "senate-efd",
      label: "Senate eFD",
      run: async () => {
        const { trades, filings, roster } = await fetchSenateTrades();
        return { trades, filings, roster };
      },
    });
  }

  // --- Keyed aggregators: on when their key is present ---
  const keyed: Array<[SourceId, string, () => Promise<Trade[]>]> = [
    ["quiver", "Quiver Quantitative", fetchQuiverTrades],
    ["unusual-whales", "Unusual Whales", fetchUnusualWhalesTrades],
    ["fmp", "Financial Modeling Prep", () => fetchFmpTrades()],
    ["congressinvests", "CongressInvests", fetchCongressInvestsTrades],
    ["lambda", "Lambda Finance", fetchLambdaTrades],
  ];

  for (const [id, label, fn] of keyed) {
    const config = AGGREGATORS.find((a) => a.id === id);
    if (!config?.configured) continue;
    plan.push({ id, label, run: async () => ({ trades: await fn() }) });
  }

  return plan;
}

/** Status rows for sources that are available but not switched on. */
function inactiveSourceStatuses(activeIds: Set<SourceId>): SourceStatus[] {
  const rows: SourceStatus[] = [];

  for (const agg of AGGREGATORS) {
    if (activeIds.has(agg.id)) continue;
    rows.push({
      id: agg.id,
      label: agg.label,
      ok: true,
      active: false,
      tradeCount: 0,
      needsCredentials: true,
      message: `Set ${agg.keyEnv} to enable`,
    });
  }

  return rows;
}

/**
 * Everything the IO layer produces, before any aggregation.
 *
 * Kept separate from `Snapshot` so the expensive part (network) is cached once
 * and the cheap part (aggregation) can be recomputed for any view — the detail
 * pages need the *full* trade list, while the dashboard payload only carries a
 * truncated one.
 */
export interface RawData {
  generatedAt: string;
  isLive: boolean;
  marketOpen: boolean;
  trades: Trade[];
  filings: Filing[];
  roster: Map<string, Politician>;
  sources: SourceStatus[];
  warnings: string[];
}

export async function collectRawData(): Promise<RawData> {
  const mode = configuredMode();
  const generatedAt = new Date().toISOString();
  const marketOpen = isUsMarketOpen();
  const warnings: string[] = [];

  const outcomes: SourceOutcome[] = [];

  if (mode !== "simulated") {
    const plan = liveSourcePlan();
    const settled = await Promise.all(plan.map((p) => runSource(p.id, p.label, p.run)));
    outcomes.push(...settled);
    for (const o of settled) {
      if (!o.ok && o.message) warnings.push(`${o.label}: ${o.message}`);
    }
  }

  const liveTrades = mergeTrades(outcomes.filter((o) => o.ok).map((o) => o.trades));
  const liveFilings = outcomes.flatMap((o) => o.filings);

  // The simulator runs only in `simulated` mode or as the `auto` fallback.
  // In strict `live` mode an empty result stays empty — a published page must
  // never show placeholder filers.
  const useSimulator = mode === "simulated" || (mode === "auto" && liveTrades.length === 0);

  let trades = liveTrades;
  let isLive = liveTrades.length > 0;

  if (useSimulator) {
    trades = getSimulatedTrades();
    isLive = false;
    outcomes.push({
      id: "simulated",
      label: "Built-in simulator",
      trades,
      filings: [],
      roster: [],
      ok: true,
      message:
        mode === "simulated"
          ? "CONGRESS_DATA_SOURCE=simulated"
          : "No live source returned transactions — showing simulated data",
    });
    if (mode !== "simulated") {
      warnings.push(
        "No configured source returned transaction-level data. Showing SIMULATED trades with fictional filers. " +
          "The House Clerk index is filing-level only (detail is inside each PDF); add an aggregator API key for real ticker-level House data.",
      );
    }
  } else if (trades.length === 0) {
    warnings.push(
      "Live mode: no source has returned transaction-level data yet. " +
        "The House Clerk index is filing-level only (transaction detail lives in each PDF); " +
        "Senate eFD provides ticker-level trades when reachable, and aggregator API keys add House transactions.",
    );
  }

  // Roster: live metadata first, demo roster only when simulating.
  const roster = new Map<string, Politician>();
  for (const o of outcomes) for (const p of o.roster) if (!roster.has(p.id)) roster.set(p.id, p);
  if (useSimulator) for (const [id, p] of demoRoster()) if (!roster.has(id)) roster.set(id, p);

  const activeIds = new Set(outcomes.map((o) => o.id));
  const sources: SourceStatus[] = [
    ...outcomes.map((o) => ({
      id: o.id,
      label: o.label,
      ok: o.ok,
      active: o.ok && (o.trades.length > 0 || o.filings.length > 0),
      tradeCount: o.trades.length,
      message: o.message,
    })),
    ...inactiveSourceStatuses(activeIds),
  ];

  return {
    generatedAt,
    isLive,
    marketOpen,
    trades,
    filings: liveFilings.sort((a, b) => b.filedDate.localeCompare(a.filedDate)),
    roster,
    sources,
    warnings,
  };
}

/** Pure aggregation step: turn collected records into the dashboard payload. */
export function assembleSnapshot(raw: RawData): Snapshot {
  const politicians = buildPoliticians(raw.trades, raw.roster);
  const assets = buildAssets(raw.trades);
  const stats = buildStats(raw.trades, politicians, assets);

  const simulated = raw.sources.some((s) => s.id === "simulated" && s.active);

  return {
    generatedAt: raw.generatedAt,
    isLive: raw.isLive,
    dataState: raw.isLive ? "live" : simulated ? "simulated" : "empty",
    marketOpen: raw.marketOpen,
    stats,
    politicians,
    assets,
    recentTrades: raw.trades.slice(0, 150),
    recentFilings: raw.filings.slice(0, 60),
    sources: raw.sources,
    warnings: raw.warnings,
  };
}
