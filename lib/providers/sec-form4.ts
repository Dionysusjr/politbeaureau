import { httpJson } from "./http";
import { toIsoDate } from "../normalize";

/**
 * SEC EDGAR Form 4 — corporate insider transactions. Free, no key, but the SEC's
 * fair-access policy requires a descriptive User-Agent with a contact address
 * (set CONTACT_EMAIL; see providers/http.ts).
 *
 * This is deliberately a *separate* feed from the political disclosures: Form 4
 * filers are company officers, directors and 10% owners, not members of Congress.
 * It appears on the asset page as corporate-insider context alongside political
 * activity in the same ticker — useful, but never merged into the politician
 * aggregates, which would conflate two different disclosure regimes.
 */

export interface InsiderFiling {
  /** Reporting owner, when EDGAR exposes it on the submission record. */
  owner?: string;
  form: string;
  filedDate: string;
  reportDate?: string;
  accessionNumber: string
  documentUrl: string;
}

interface TickerMapEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

let tickerMapCache: Map<string, { cik: string; title: string }> | null = null;
let tickerMapFetchedAt = 0;
const TICKER_MAP_TTL_MS = 24 * 60 * 60 * 1000;

/** ticker -> zero-padded CIK, from EDGAR's published mapping file. */
async function tickerMap(): Promise<Map<string, { cik: string; title: string }>> {
  if (tickerMapCache && Date.now() - tickerMapFetchedAt < TICKER_MAP_TTL_MS) {
    return tickerMapCache;
  }

  const payload = await httpJson<Record<string, TickerMapEntry>>(
    "https://www.sec.gov/files/company_tickers.json",
    { timeoutMs: 30_000 },
  );

  const map = new Map<string, { cik: string; title: string }>();
  for (const entry of Object.values(payload)) {
    if (!entry?.ticker) continue;
    map.set(entry.ticker.toUpperCase(), {
      cik: String(entry.cik_str).padStart(10, "0"),
      title: entry.title,
    });
  }

  tickerMapCache = map;
  tickerMapFetchedAt = Date.now();
  return map;
}

interface SubmissionsPayload {
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocument?: string[];
    };
  };
}

/**
 * Recent Form 4 filings for a ticker. Returns [] when the ticker isn't in
 * EDGAR's map (ETFs, funds, untickered assets) rather than throwing, since a
 * missing insider feed is normal, not an error.
 */
export async function fetchInsiderFilings(ticker: string, limit = 12): Promise<InsiderFiling[]> {
  const map = await tickerMap();
  const entry = map.get(ticker.toUpperCase());
  if (!entry) return [];

  const payload = await httpJson<SubmissionsPayload>(
    `https://data.sec.gov/submissions/CIK${entry.cik}.json`,
    { timeoutMs: 30_000 },
  );

  const recent = payload.filings?.recent;
  if (!recent?.form) return [];

  const out: InsiderFiling[] = [];
  const cikNumeric = String(Number(entry.cik));

  for (let i = 0; i < recent.form.length && out.length < limit; i++) {
    const form = recent.form[i];
    if (form !== "4" && form !== "4/A") continue;

    const accession = recent.accessionNumber?.[i];
    const filedDate = toIsoDate(recent.filingDate?.[i]);
    if (!accession || !filedDate) continue;

    const bare = accession.replace(/-/g, "");
    const primary = recent.primaryDocument?.[i];

    out.push({
      form,
      filedDate,
      reportDate: toIsoDate(recent.reportDate?.[i]),
      accessionNumber: accession,
      documentUrl: primary
        ? `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${bare}/${primary}`
        : `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${bare}/`,
    });
  }

  return out;
}
