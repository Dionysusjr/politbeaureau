import { unzipSync, strFromU8 } from "fflate";
import * as cheerio from "cheerio";
import { httpFetch } from "./http";
import { cleanPersonName, politicianId, toIsoDate } from "../normalize";
import { Filing, Politician } from "../types";

/**
 * House Clerk financial disclosures — official primary source, free, no key.
 *
 *   https://disclosures-clerk.house.gov/public_disc/financial-pdfs/<YEAR>FD.zip
 *
 * The ZIP contains a machine-readable index (`<YEAR>FD.xml`) plus the filing
 * PDFs. The index gives us filer, filing type, state/district, filing date and
 * a document id.
 *
 * IMPORTANT LIMITATION: the index is filing-level only. Individual transaction
 * rows — ticker, amount bracket, buy/sell — exist only inside each PTR **PDF**,
 * many of which are scans requiring OCR. So this provider yields `Filing`
 * records and roster metadata, never `Trade` records. Ticker-level House data
 * needs either an aggregator (Quiver / Unusual Whales / Finnhub / FMP, which do
 * the PDF extraction themselves) or your own PDF+OCR pipeline.
 */

const ZIP_URL = (year: number) =>
  `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;

/** Filing-type codes used in the House index. */
const FILING_TYPE: Record<string, string> = {
  P: "Periodic Transaction Report",
  O: "Annual Report",
  A: "Amendment",
  C: "Candidate Report",
  T: "Termination Report",
  X: "Extension Request",
  D: "Blind Trust / Other",
  W: "Withdrawal",
};

export interface HouseIndexResult {
  filings: Filing[];
  roster: Politician[];
}

/** "CA11" -> { state: "CA", district: 11 }; "CA00" means at-large/undesignated. */
function parseStateDistrict(raw: string): { state: string; district?: number } {
  const text = (raw ?? "").trim().toUpperCase();
  const match = text.match(/^([A-Z]{2})(\d{0,2})$/);
  if (!match?.[1]) return { state: text.slice(0, 2) || "US" };
  const district = match[2] ? Number(match[2]) : undefined;
  return {
    state: match[1],
    district: district && district > 0 ? district : undefined,
  };
}

/**
 * PTRs and annual reports live under different paths on the Clerk's site.
 * Codes other than "P" are annual-style filings served from `financial-pdfs`.
 */
function documentUrl(year: number, docId: string, code: string): string | undefined {
  if (!docId) return undefined;
  const dir = code === "P" ? "ptr-pdfs" : "financial-pdfs";
  return `https://disclosures-clerk.house.gov/public_disc/${dir}/${year}/${docId}.pdf`;
}

/**
 * Parse the `<YEAR>FD.xml` index. Exported so the parser can be exercised
 * against a fixture without network access.
 */
export function parseHouseIndexXml(xml: string, year: number): HouseIndexResult {
  const $ = cheerio.load(xml, { xmlMode: true });
  const filings: Filing[] = [];
  const rosterById = new Map<string, Politician>();

  $("Member").each((_, el) => {
    const node = $(el);
    const text = (sel: string) => node.find(sel).first().text().trim();

    const last = text("Last");
    const first = text("First");
    if (!last && !first) return;

    const suffix = text("Suffix");
    const rawName = [first, last, suffix].filter(Boolean).join(" ");
    const name = cleanPersonName(rawName);
    const id = politicianId(name, "house");

    const code = (text("FilingType") || "").toUpperCase();
    const docId = text("DocID");
    const filedDate = toIsoDate(text("FilingDate")) ?? `${year}-01-01`;
    const { state, district } = parseStateDistrict(text("StateDst"));
    const filingYear = Number(text("Year")) || year;

    filings.push({
      id: `house-${docId || `${id}-${filedDate}`}`,
      politicianId: id,
      politicianName: name,
      chamber: "house",
      state,
      district,
      filingType: FILING_TYPE[code] ?? (code ? `Filing type ${code}` : "Filing"),
      filingTypeCode: code || undefined,
      filedDate,
      year: filingYear,
      documentUrl: documentUrl(filingYear, docId, code),
      source: "house-clerk",
      // Every House filing's transaction detail is PDF-only.
      detailInPdfOnly: true,
    });

    if (!rosterById.has(id)) {
      rosterById.set(id, {
        id,
        name,
        chamber: "house",
        party: "unknown", // The Clerk's index does not carry party.
        state,
        district,
        role: "Representative",
        committees: [],
      });
    }
  });

  filings.sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  return { filings, roster: [...rosterById.values()] };
}

/** Download and parse one year's House disclosure index. */
export async function fetchHouseIndex(year: number): Promise<HouseIndexResult> {
  const url = ZIP_URL(year);
  const res = await httpFetch(url, { timeoutMs: 60_000, headers: { Accept: "application/zip" } });
  if (!res.ok) throw new Error(`House Clerk returned HTTP ${res.status} for ${year}FD.zip`);

  const buffer = new Uint8Array(await res.arrayBuffer());
  const entries = unzipSync(buffer);

  const xmlName = Object.keys(entries).find((n) => n.toLowerCase().endsWith(".xml"));
  if (!xmlName) {
    throw new Error(`${year}FD.zip contained no XML index (entries: ${Object.keys(entries).join(", ")})`);
  }

  return parseHouseIndexXml(strFromU8(entries[xmlName]!), year);
}

/**
 * Fetch the current year and, when we're early in the year, the previous one too
 * so the feed isn't nearly empty every January.
 */
export async function fetchHouseFilings(): Promise<HouseIndexResult> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const years = now.getUTCMonth() < 3 ? [year, year - 1] : [year];

  const results = await Promise.allSettled(years.map((y) => fetchHouseIndex(y)));
  const ok = results.filter(
    (r): r is PromiseFulfilledResult<HouseIndexResult> => r.status === "fulfilled",
  );

  if (ok.length === 0) {
    const reason = results[0]?.status === "rejected" ? results[0].reason : "unknown error";
    throw new Error(reason instanceof Error ? reason.message : String(reason));
  }

  const filings = ok.flatMap((r) => r.value.filings);
  const rosterById = new Map<string, Politician>();
  for (const r of ok) for (const p of r.value.roster) if (!rosterById.has(p.id)) rosterById.set(p.id, p);

  filings.sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  return { filings, roster: [...rosterById.values()] };
}
