import { AssetClass, Chamber, FilerOwner, Party, TradeType } from "./types";

/**
 * Normalisation helpers shared by every provider, so records arriving from a
 * House PDF index, a Senate HTML table and a JSON aggregator all collapse onto
 * the same shape (and the same dedupe key).
 */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build a stable politician id that survives small formatting differences. */
export function politicianId(name: string, chamber: Chamber): string {
  return `${chamber.slice(0, 3)}-${slugify(cleanPersonName(name))}`;
}

/**
 * Filings render names inconsistently ("Hon.. Nancy Pelosi", "Pelosi, Nancy",
 * "Greene, Marjorie Taylor  (Mrs.)"). Collapse to "First Last".
 */
export function cleanPersonName(raw: string): string {
  let name = raw.replace(/\s+/g, " ").trim();
  name = name.replace(/^(hon\.*|mr\.|mrs\.|ms\.|dr\.|rep\.|sen\.|senator|representative)\s+/gi, "");
  name = name.replace(/\s*\((?:mr|mrs|ms|dr|jr|sr|self|spouse)\.?\)\s*$/gi, "");
  name = name.replace(/,\s*(jr|sr|ii|iii|iv)\.?$/gi, "");

  // "Last, First Middle" -> "First Middle Last"
  const comma = name.match(/^([^,]+),\s*(.+)$/);
  if (comma?.[1] && comma[2]) name = `${comma[2].trim()} ${comma[1].trim()}`;

  return name.replace(/\s+/g, " ").trim();
}

/** Uppercase, strip exchange suffixes and junk that filings append to tickers. */
export function normalizeTicker(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let t = raw.toUpperCase().trim();
  t = t.replace(/^\$/, "");
  t = t.replace(/\s*\(.*\)\s*$/, "");
  t = t.replace(/\.(US|N|O|OQ|K)$/i, "");
  t = t.replace(/[^A-Z0-9.\-]/g, "");
  if (!t || t.length > 8) return undefined;
  // Filings use these as "no ticker" placeholders.
  if (["NA", "N/A", "NONE", "--", "-", "UNKNOWN"].includes(t)) return undefined;
  return t;
}

const TRADE_TYPE_MAP: Array<[RegExp, TradeType]> = [
  [/partial\s*sale|sale\s*\(?\s*partial|sale_partial|^sp$/i, "partial_sale"],
  [/exchange|^e$/i, "exchange"],
  [/sale|sell|sold|divest|^s$|^sf$/i, "sale"],
  [/purchase|buy|bought|acquis|^p$/i, "purchase"],
];

export function normalizeTradeType(raw: string | null | undefined): TradeType {
  const text = (raw ?? "").trim();
  for (const [re, value] of TRADE_TYPE_MAP) if (re.test(text)) return value;
  return "purchase";
}

export function normalizeOwner(raw: string | null | undefined): FilerOwner {
  const t = (raw ?? "").toLowerCase();
  if (/spouse|sp\b/.test(t)) return "spouse";
  if (/joint|jt\b/.test(t)) return "joint";
  if (/depend|child|dc\b/.test(t)) return "dependent";
  if (/self|filer|own/.test(t)) return "self";
  return "unknown";
}

export function normalizeParty(raw: string | null | undefined): Party {
  const t = (raw ?? "").trim().toLowerCase();
  if (/^d|democrat/.test(t)) return "D";
  if (/^r|republic/.test(t)) return "R";
  if (/^i|independ/.test(t)) return "I";
  return "unknown";
}

export function normalizeChamber(raw: string | null | undefined): Chamber {
  const t = (raw ?? "").toLowerCase();
  if (/senat/.test(t)) return "senate";
  if (/house|represent/.test(t)) return "house";
  if (/exec|cabinet|president|agency/.test(t)) return "executive";
  return "house";
}

/**
 * Infer asset class from the disclosed description. Filings are free text, so
 * this is keyword-based and deliberately conservative: anything unrecognised
 * with a ticker is treated as a stock, without one as "other".
 */
export function inferAssetClass(assetName: string, ticker?: string): AssetClass {
  const t = assetName.toLowerCase();

  if (/\b(call|put)\b|option|strike|expir/.test(t)) return "option";
  if (/bitcoin|ethereum|crypto|coinbase wallet|\bbtc\b|\beth\b|digital asset/.test(t)) return "crypto";
  if (/municipal|muni bond|\bgo bond\b|school district|revenue bond/.test(t)) return "municipal_bond";
  if (/treasury|t-bill|tbill|t-note|savings bond|\bus\s*gov.*bond|sovereign/.test(t)) return "treasury";
  if (/corporate bond|\bnote due\b|debenture|\bbond\b/.test(t)) return "corporate_bond";
  // "Mutual fund" is an explicit, unambiguous label — check it before the ETF
  // heuristics, which would otherwise claim anything called an "index fund".
  if (/mutual fund/.test(t)) return "mutual_fund";
  if (/\betf\b|exchange[- ]traded|\bishares\b|\bspdr\b|\bqqq\b|index trust/.test(t)) return "etf";
  if (/index fund|\bfund\b|money market|\bira\b|401\(?k\)?/.test(t)) return "mutual_fund";
  if (/\breit\b|real estate invest/.test(t)) return "reit";
  if (/\bipo\b|initial public offering/.test(t)) return "ipo";
  if (/stock|common shares|common stock|ordinary shares|class [ab] shares/.test(t)) return "stock";

  return ticker ? "stock" : "other";
}

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  stock: "Stock",
  etf: "ETF",
  mutual_fund: "Mutual fund",
  corporate_bond: "Corporate bond",
  municipal_bond: "Municipal bond",
  treasury: "Treasury",
  option: "Option",
  crypto: "Crypto",
  reit: "REIT",
  ipo: "IPO",
  other: "Other",
};

export const TRADE_TYPE_LABEL: Record<TradeType, string> = {
  purchase: "Purchase",
  sale: "Sale",
  partial_sale: "Partial sale",
  exchange: "Exchange",
};

export const OWNER_LABEL: Record<FilerOwner, string> = {
  self: "Self",
  spouse: "Spouse",
  joint: "Joint",
  dependent: "Dependent",
  unknown: "—",
};

/** Whole days between two ISO dates, floored at 0. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Coerce the many date formats filings use into ISO yyyy-mm-dd. */
export function toIsoDate(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us?.[1] && us[2] && us[3]) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return undefined;
}

/**
 * Dedupe key for a trade. Two providers reporting the same filing must collapse
 * to one record, so the key uses only fields every source supplies.
 */
export function tradeKey(parts: {
  politicianId: string;
  ticker?: string;
  assetName: string;
  transactionDate: string;
  type: TradeType;
  amountMin: number;
}): string {
  const asset = parts.ticker ?? slugify(parts.assetName).slice(0, 32);
  return [parts.politicianId, asset, parts.transactionDate, parts.type, parts.amountMin].join("|");
}
