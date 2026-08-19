/**
 * Domain model for US political / executive-branch trading disclosures.
 *
 * Everything here is shaped around what the *primary sources* actually publish:
 * filers disclose transactions in **amount brackets**, not exact dollar values
 * (STOCK Act / Ethics in Government Act). So a trade carries `amountMin` /
 * `amountMax` and we derive a midpoint for ranking. Any single-number figure in
 * this app is an estimate derived from a bracket, never a reported exact value.
 */

export type Chamber = "house" | "senate" | "executive";

export type Party = "D" | "R" | "I" | "unknown";

/** Broad asset class, inferred from the disclosed asset description. */
export type AssetClass =
  | "stock"
  | "etf"
  | "mutual_fund"
  | "corporate_bond"
  | "municipal_bond"
  | "treasury"
  | "option"
  | "crypto"
  | "reit"
  | "ipo"
  | "other";

/** Direction of the disclosed transaction. */
export type TradeType = "purchase" | "sale" | "partial_sale" | "exchange";

/** Who actually owns the asset, as disclosed on the filing. */
export type FilerOwner = "self" | "spouse" | "joint" | "dependent" | "unknown";

/**
 * Portfolio-size tier. Drives the ranking colours requested for the dashboard:
 * mega=gold, large=green, medium=blue, small=red.
 */
export type PortfolioTier = "mega" | "large" | "medium" | "small";

/** Which upstream produced a record. Used for provenance badges + dedupe. */
export type SourceId =
  | "simulated"
  | "house-clerk"
  | "senate-efd"
  | "oge-integrity"
  | "sec-form4"
  | "unusual-whales"
  | "quiver"
  | "fmp"
  | "finnhub"
  | "congressinvests"
  | "lambda"
  | "apify"
  | "supabase";

export interface Politician {
  /** Stable slug, e.g. "hse-avery-jordan". */
  id: string;
  name: string;
  chamber: Chamber;
  party: Party;
  /** Two-letter state / territory code, or "US" for executive-branch filers. */
  state: string;
  /** House district number; undefined for senators and executive filers. */
  district?: number;
  /** Role label, e.g. "Representative", "Senator", "Cabinet Secretary". */
  role: string;
  committees: string[];
}

export interface Trade {
  /** Deterministic id — also the dedupe key across providers. */
  id: string;
  politicianId: string;
  politicianName: string;
  chamber: Chamber;
  party: Party;
  state: string;

  /** Ticker where the filing disclosed one; undefined for unlisted assets. */
  ticker?: string;
  assetName: string;
  assetClass: AssetClass;

  type: TradeType;
  owner: FilerOwner;

  /** Date the transaction happened, ISO yyyy-mm-dd. */
  transactionDate: string;
  /** Date the filing was received/published, ISO yyyy-mm-dd. */
  disclosureDate: string;
  /** Reporting lag in days — the number that matters for STOCK Act compliance. */
  filingDelayDays: number;

  /** Disclosed bracket bounds in USD. */
  amountMin: number;
  amountMax: number;
  /** Midpoint estimate used for all ranking/aggregation. Never a reported value. */
  amountMid: number;
  /** Human-readable bracket exactly as filers report it, e.g. "$1,001 - $15,000". */
  amountRange: string;

  source: SourceId;
  /** Link to the underlying filing (PDF/HTML) when the source exposes one. */
  filingUrl?: string;
  /** True when the filer flagged capital gains over $200. */
  capitalGainsOver200?: boolean;
  comment?: string;
}

/**
 * A disclosure *filing* — the unit the primary sources publish.
 *
 * This matters because the House Clerk's machine-readable index lists filings,
 * not transactions: the transaction rows live inside the linked PDF. So a
 * filings feed is what free primary sources can honestly give us at the index
 * level, and it stands on its own (who filed, what kind, when, link to source).
 */
export interface Filing {
  id: string;
  politicianId: string;
  politicianName: string;
  chamber: Chamber;
  state: string;
  district?: number;
  /** Filing kind, e.g. "Periodic Transaction Report", "Annual Report". */
  filingType: string;
  /** Raw code from the source, e.g. "P", "O", "A". */
  filingTypeCode?: string;
  filedDate: string;
  year: number;
  documentUrl?: string;
  source: SourceId;
  /**
   * True when transaction-level detail exists only in an attached PDF, so this
   * filing contributes no rows to the ticker-level views.
   */
  detailInPdfOnly?: boolean;
}

/** A politician's current estimated position in one asset, built from their trades. */
export interface Holding {
  ticker?: string;
  assetName: string;
  assetClass: AssetClass;
  /** Net disclosed flow (purchases minus sales) in USD midpoints. */
  netValue: number;
  purchaseValue: number;
  saleValue: number;
  tradeCount: number
  lastTradeDate: string;
}

export interface PoliticianSummary extends Politician {
  /**
   * Estimated portfolio size: sum of bracket midpoints of disclosed *purchases*
   * plus retained positions. An estimate from brackets, not a reported total.
   */
  portfolioValue: number;
  portfolioValueMin: number;
  portfolioValueMax: number;
  tier: PortfolioTier;
  /** 1-based rank by portfolioValue across all filers in the snapshot. */
  rank: number;
  tradeCount: number;
  purchaseCount: number;
  saleCount: number;
  buyValue: number;
  sellValue: number;
  /** Distinct tickers touched. */
  uniqueAssets: number;
  topAssets: Array<{ ticker?: string; assetName: string; value: number }>;
  assetClassMix: Array<{ assetClass: AssetClass; value: number }>;
  lastTradeDate?: string;
  avgFilingDelayDays: number;
}

export interface PoliticianDetail extends PoliticianSummary {
  trades: Trade[];
  holdings: Holding[];
}

/** One point on an asset's price history. */
export interface PricePoint {
  date: string;
  close: number;
}

export interface AssetQuote {
  ticker: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  currency: string;
  /** True when the numbers came from a real upstream rather than the simulator. */
  isLive: boolean;
  asOf: string;
}

export interface AssetSummary {
  /** Route-safe identifier: the ticker when there is one, else a name slug. */
  id: string;
  ticker?: string;
  name: string;
  assetClass: AssetClass;
  /** Total disclosed purchase value (bracket midpoints) in USD. */
  buyValue: number;
  sellValue: number;
  netValue: number;
  tradeCount: number;
  purchaseCount: number;
  saleCount: number;
  /** Distinct politicians who traded it. */
  politicianCount: number;
  buyerCount: number;
  sellerCount: number;
  /** Party split of politicians trading it, for the bipartisan-interest read. */
  partySplit: { D: number; R: number; I: number };
  lastTradeDate: string;
  quote?: AssetQuote;
}

export interface AssetTrader {
  politicianId: string;
  politicianName: string;
  chamber: Chamber;
  party: Party;
  state: string;
  tier: PortfolioTier;
  buyValue: number;
  sellValue: number;
  netValue: number;
  tradeCount: number;
  firstTradeDate: string;
  lastTradeDate: string;
  /**
   * Price change since their first disclosed purchase, when price history is
   * available. Illustrative only — brackets mean we never know real size/basis.
   */
  returnSinceFirstBuyPct?: number;
}

export interface AssetDetail extends AssetSummary {
  quote?: AssetQuote;
  history: PricePoint[];
  /** Performance over standard windows, derived from `history`. */
  performance: Array<{ label: string; changePct: number | null }>;
  traders: AssetTrader[];
  trades: Trade[];
}

export interface SnapshotStats {
  totalTrades: number;
  totalDisclosedValue: number;
  buyValue: number;
  sellValue: number;
  politicianCount: number;
  assetCount: number;
  /** Trades whose disclosure date falls within the last 7 days. */
  newThisWeek: number;
  avgFilingDelayDays: number;
  tierCounts: Record<PortfolioTier, number>;
}

/** Per-source health, surfaced in the UI so a dead upstream is visible. */
export interface SourceStatus {
  id: SourceId;
  label: string;
  ok: boolean;
  /** True when this source contributed to the current snapshot. */
  active: boolean;
  tradeCount: number;
  message?: string;
  /** True when the source needs an API key that isn't configured. */
  needsCredentials?: boolean;
}

/**
 * What the snapshot's records actually are:
 *   live      - real disclosures from live sources
 *   simulated - the built-in simulator (fictional filers), clearly labelled
 *   empty     - strict live mode with no data returned yet (never placeholder)
 */
export type SnapshotDataState = "live" | "simulated" | "empty";

export interface Snapshot {
  generatedAt: string;
  /** False when every record came from the simulator. */
  isLive: boolean;
  dataState: SnapshotDataState;
  marketOpen: boolean;
  stats: SnapshotStats;
  politicians: PoliticianSummary[];
  assets: AssetSummary[];
  /** Most recent trades by disclosure date, newest first. */
  recentTrades: Trade[];
  /**
   * Most recent filings from primary sources, newest first. Present even when
   * no transaction-level source is configured.
   */
  recentFilings: Filing[];
  sources: SourceStatus[];
  warnings: string[];
}
