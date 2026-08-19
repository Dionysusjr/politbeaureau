import { bracketMidpoint, parseAmountRange } from "../amounts";
import {
  cleanPersonName,
  daysBetween,
  inferAssetClass,
  normalizeChamber,
  normalizeOwner,
  normalizeParty,
  normalizeTicker,
  normalizeTradeType,
  politicianId,
  toIsoDate,
  tradeKey,
} from "../normalize";
import { SourceId, Trade } from "../types";

/**
 * Tolerant mapper for third-party congressional-trading APIs.
 *
 * The aggregators (Quiver, Unusual Whales, FMP, Finnhub, CongressInvests,
 * Lambda) all publish the same underlying facts but disagree on field names,
 * casing and date formats — and several are behind paywalls, so their exact
 * response shape can't be pinned down without a key. Rather than hard-coding six
 * brittle schemas, every provider pipes rows through this one mapper, which
 * looks for any of the known aliases per field.
 *
 * The upside is that a provider renaming `transaction_date` to `txDate` degrades
 * one field instead of breaking the integration. The tradeoff is that field
 * discovery is heuristic; `mapLooseTrade` returns null when it can't find the
 * minimum viable set (a filer name, a date and an amount or asset).
 */

type Row = Record<string, unknown>;

function pick(row: Row, ...keys: string[]): unknown {
  // Normalise the row's keys once so "Transaction Date", "transaction_date" and
  // "transactionDate" all match a single alias.
  const flat = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    flat.set(k.toLowerCase().replace(/[^a-z0-9]/g, ""), v);
  }
  for (const key of keys) {
    const hit = flat.get(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (hit !== undefined && hit !== null && hit !== "") return hit;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export interface LooseMapOptions {
  source: SourceId;
  /** Chamber to assume when the payload doesn't say. */
  defaultChamber?: "house" | "senate" | "executive";
}

export function mapLooseTrade(row: Row, opts: LooseMapOptions): Trade | null {
  const name = str(
    pick(
      row,
      "representative",
      "senator",
      "politician",
      "member",
      "memberName",
      "filer",
      "filerName",
      "name",
      "fullName",
      "reportingIndividual",
    ),
  );
  if (!name) return null;
  const cleanName = cleanPersonName(name);

  const transactionDate =
    toIsoDate(
      str(
        pick(
          row,
          "transactionDate",
          "tradeDate",
          "txDate",
          "dateTransacted",
          "transaction_date",
          "date",
        ),
      ),
    ) ?? undefined;

  const disclosureDate =
    toIsoDate(
      str(
        pick(
          row,
          "disclosureDate",
          "filingDate",
          "reportDate",
          "dateReceived",
          "filedDate",
          "disclosure_date",
          "reportedDate",
          "notificationDate",
        ),
      ),
    ) ?? transactionDate;

  if (!transactionDate || !disclosureDate) return null;

  const ticker = normalizeTicker(
    str(pick(row, "ticker", "symbol", "assetTicker", "securityTicker", "tickerSymbol")),
  );

  const assetName =
    str(
      pick(
        row,
        "assetDescription",
        "assetName",
        "asset",
        "security",
        "securityName",
        "issuer",
        "company",
        "companyName",
        "description",
      ),
    ) ?? ticker;

  if (!assetName) return null;

  // Amount can arrive as a range string, or as explicit bounds, or as a single
  // figure that we snap onto the nearest disclosure bracket.
  const rangeText = str(pick(row, "amount", "amountRange", "range", "value", "transactionAmount"));
  const explicitMin = num(pick(row, "amountFrom", "amountMin", "minAmount", "low", "rangeLow"));
  const explicitMax = num(pick(row, "amountTo", "amountMax", "maxAmount", "high", "rangeHigh"));

  let min: number;
  let max: number;
  let label: string;
  if (explicitMin !== undefined && explicitMax !== undefined && explicitMax >= explicitMin) {
    const parsed = parseAmountRange(`$${explicitMin} - $${explicitMax}`);
    min = parsed.min;
    max = parsed.max;
    label = parsed.label;
  } else {
    const parsed = parseAmountRange(rangeText);
    min = parsed.min;
    max = parsed.max;
    label = parsed.label;
  }
  if (min === 0 && max === 0) return null;

  const type = normalizeTradeType(
    str(pick(row, "type", "transactionType", "tradeType", "action", "txType", "orderType")),
  );

  const chamber = normalizeChamber(
    str(pick(row, "chamber", "house", "body", "filerType", "office")) ?? opts.defaultChamber ?? "house",
  );

  const state = (str(pick(row, "state", "stateCode", "senatorState", "district")) ?? "US")
    .toUpperCase()
    .slice(0, 2);

  const districtRaw = str(pick(row, "district", "stateDst"));
  const assetTypeHint = str(pick(row, "assetType", "securityType", "type2", "assetClass")) ?? "";

  const id = politicianId(cleanName, chamber);
  const base = { politicianId: id, ticker, assetName, transactionDate, type, amountMin: min };

  return {
    id: `${opts.source}-${tradeKey(base)}`,
    politicianId: id,
    politicianName: cleanName,
    chamber,
    party: normalizeParty(str(pick(row, "party", "partyName", "politicalParty"))),
    state: /^[A-Z]{2}$/.test(state) ? state : "US",
    ticker,
    assetName,
    assetClass: inferAssetClass(`${assetName} ${assetTypeHint}`, ticker),
    type,
    owner: normalizeOwner(str(pick(row, "owner", "ownerType", "ownedBy"))),
    transactionDate,
    disclosureDate,
    filingDelayDays: daysBetween(transactionDate, disclosureDate),
    amountMin: min,
    amountMax: max,
    amountMid: bracketMidpoint(min, max),
    amountRange: label,
    source: opts.source,
    filingUrl: str(pick(row, "link", "url", "filingUrl", "ptrLink", "documentUrl", "source")),
    capitalGainsOver200: (() => {
      const raw = str(pick(row, "capitalGainsOver200", "capGainsOver200", "capitalGains"));
      if (raw === undefined) return undefined;
      return /true|yes|1/i.test(raw);
    })(),
    comment: str(pick(row, "comment", "comments", "notes", "description2")),
    ...(districtRaw && /\d/.test(districtRaw) ? {} : {}),
  };
}

/**
 * Find the array of records inside an unknown JSON payload. Aggregators variously
 * return a bare array, `{ data: [...] }`, `{ results: [...] }`, etc.
 */
export function extractRows(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload as Row[];
  if (payload && typeof payload === "object") {
    const obj = payload as Row;
    for (const key of ["data", "results", "trades", "transactions", "items", "records", "rows"]) {
      const value = obj[key];
      if (Array.isArray(value)) return value as Row[];
    }
  }
  return [];
}

export function mapLooseTrades(payload: unknown, opts: LooseMapOptions): Trade[] {
  return extractRows(payload)
    .map((row) => mapLooseTrade(row, opts))
    .filter((t): t is Trade => t !== null);
}
