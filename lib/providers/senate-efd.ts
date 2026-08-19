import * as cheerio from "cheerio";
import { httpFetch, userAgent } from "./http";
import { parseAmountRange, bracketMidpoint } from "../amounts";
import {
  cleanPersonName,
  daysBetween,
  inferAssetClass,
  normalizeOwner,
  normalizeTicker,
  normalizeTradeType,
  politicianId,
  toIsoDate,
  tradeKey,
} from "../normalize";
import { Filing, Politician, Trade } from "../types";

/**
 * Senate Electronic Financial Disclosure (eFD) — official primary source, free,
 * no API key. https://efd.senate.gov
 *
 * There is no documented API. The search screen is a DataTables widget backed by
 * a JSON endpoint, and reaching it requires a three-step handshake:
 *
 *   1. GET  /search/home/            — obtain the CSRF cookie + form token
 *   2. POST /search/home/            — accept the prohibition agreement
 *   3. POST /search/report/data/     — DataTables JSON query
 *
 * Unlike the House index, Senate *electronic* PTRs render transaction rows as an
 * HTML table, so real ticker-level trades can be parsed. Filings submitted on
 * paper are scanned images (`/search/view/paper/...`) and yield a filing record
 * with no transactions.
 *
 * Because this rides on an undocumented internal endpoint, it is best-effort:
 * markup and parameter names can change without notice, and the caller falls
 * back rather than failing the dashboard.
 */

const BASE = "https://efd.senate.gov";
const HOME = `${BASE}/search/home/`;
const DATA = `${BASE}/search/report/data/`;

/** Report type 11 = Periodic Transaction Report in eFD's taxonomy. */
const REPORT_TYPE_PTR = "11";

class CookieJar {
  private jar = new Map<string, string>();

  absorb(res: Response) {
    const raw =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
    for (const line of raw) {
      const pair = line.split(";")[0];
      const eq = pair?.indexOf("=") ?? -1;
      if (!pair || eq < 1) continue;
      this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

interface SenateSession {
  jar: CookieJar;
  token: string;
}

/** Steps 1 and 2: get a CSRF token and accept the prohibition agreement. */
async function openSession(): Promise<SenateSession> {
  const jar = new CookieJar();

  const homeRes = await httpFetch(HOME, { headers: { Accept: "text/html" } });
  if (!homeRes.ok) throw new Error(`eFD home returned HTTP ${homeRes.status}`);
  jar.absorb(homeRes);
  const html = await homeRes.text();

  const $ = cheerio.load(html);
  const token =
    $('input[name="csrfmiddlewaretoken"]').attr("value") ?? jar.get("csrftoken") ?? "";
  if (!token) throw new Error("eFD did not return a CSRF token");

  const body = new URLSearchParams({
    csrfmiddlewaretoken: token,
    prohibition_agreement: "1",
  });

  const agreeRes = await httpFetch(HOME, {
    method: "POST",
    body,
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(),
      Referer: HOME,
      Origin: BASE,
    },
  });
  jar.absorb(agreeRes);

  // A 200 or a redirect both mean the agreement was accepted.
  if (agreeRes.status >= 400) {
    throw new Error(`eFD agreement POST returned HTTP ${agreeRes.status}`);
  }

  return { jar, token: jar.get("csrftoken") ?? token };
}

interface SenateSearchRow {
  firstName: string;
  lastName: string;
  office: string;
  reportTitle: string;
  reportPath?: string;
  filedDate: string;
}

/** Step 3: query the DataTables endpoint for recent PTRs. */
async function searchReports(
  session: SenateSession,
  opts: { start: number; length: number; sinceDays: number },
): Promise<{ rows: SenateSearchRow[]; total: number }> {
  const end = new Date();
  const start = new Date(end.getTime() - opts.sinceDays * 86_400_000);
  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  const body = new URLSearchParams({
    draw: "1",
    "columns[0][data]": "0",
    "columns[1][data]": "1",
    "columns[2][data]": "2",
    "columns[3][data]": "3",
    "columns[4][data]": "4",
    "order[0][column]": "4",
    "order[0][dir]": "desc",
    start: String(opts.start),
    length: String(opts.length),
    "search[value]": "",
    "search[regex]": "false",
    first_name: "",
    last_name: "",
    filer_type: "",
    submitted_start_date: `${fmt(start)} 00:00:00`,
    submitted_end_date: `${fmt(end)} 23:59:59`,
    csrfmiddlewaretoken: session.token,
  });
  // eFD expects repeated keys for the multi-select filters.
  body.append("report_types[]", REPORT_TYPE_PTR);
  body.append("filer_types[]", "1"); // Senator
  body.append("senator_state", "");
  body.append("office_id", "");

  const res = await httpFetch(DATA, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRFToken": session.token,
      Cookie: session.jar.header(),
      Referer: HOME,
      Origin: BASE,
      "User-Agent": userAgent(),
    },
  });

  if (!res.ok) throw new Error(`eFD search returned HTTP ${res.status}`);

  const payload = (await res.json()) as { data?: unknown[][]; recordsTotal?: number };
  const rows: SenateSearchRow[] = [];

  for (const row of payload.data ?? []) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const cell = (i: number) => String(row[i] ?? "");

    // Column 3 is an anchor: <a href="/search/view/ptr/<id>/">Title</a>
    const linkHtml = cell(3);
    const $link = cheerio.load(linkHtml);
    const href = $link("a").attr("href");
    const title = $link("a").text().trim() || linkHtml.replace(/<[^>]*>/g, "").trim();

    rows.push({
      firstName: cheerio.load(cell(0)).text().trim(),
      lastName: cheerio.load(cell(1)).text().trim(),
      office: cheerio.load(cell(2)).text().trim(),
      reportTitle: title,
      reportPath: href ? (href.startsWith("http") ? href : `${BASE}${href}`) : undefined,
      filedDate: toIsoDate(cheerio.load(cell(4)).text().trim()) ?? "",
    });
  }

  return { rows, total: Number(payload.recordsTotal ?? rows.length) };
}

/** eFD office strings look like "Warner, Mark R. (Senator)" or "Virginia". */
function stateFromOffice(office: string): string {
  const paren = office.match(/\(([^)]+)\)\s*$/)?.[1] ?? office;
  const code = paren.trim().match(/\b([A-Z]{2})\b/);
  return code?.[1] ?? "US";
}

/**
 * Parse the transactions table out of an electronic PTR page.
 *
 * Column order on eFD is: #, Transaction Date, Owner, Ticker, Asset Name,
 * Asset Type, Type, Amount, Comment. Headers are matched by name rather than
 * fixed position so a column insertion doesn't silently shift every field.
 * Exported for fixture-based testing without network access.
 */
export function parseSenatePtrHtml(
  html: string,
  context: {
    politicianId: string;
    politicianName: string;
    state: string;
    filedDate: string;
    filingUrl?: string;
  },
): Trade[] {
  const $ = cheerio.load(html);
  const trades: Trade[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const headers = $table
      .find("thead th")
      .map((__, th) => $(th).text().trim().toLowerCase())
      .get();
    if (headers.length === 0) return;

    /**
     * Resolve a column by header name, preferring an exact match over a
     * substring one and skipping columns already claimed.
     *
     * The exact-match pass is essential: "Type" and "Asset Type" both contain
     * "type", and a substring search hits "Asset Type" first — which silently
     * reads the security's class as the transaction direction and turns every
     * sale into a purchase.
     */
    const col = (names: string[], exclude: number[] = []) => {
      const usable = (i: number) => i >= 0 && !exclude.includes(i);
      for (const n of names) {
        const exact = headers.findIndex((h, i) => h === n && usable(i));
        if (exact >= 0) return exact;
      }
      for (const n of names) {
        const partial = headers.findIndex((h, i) => h.includes(n) && usable(i));
        if (partial >= 0) return partial;
      }
      return -1;
    };

    const iDate = col(["transaction date", "date"]);
    const iOwner = col(["owner"]);
    const iTicker = col(["ticker"]);
    const iAssetType = col(["asset type", "security type"]);
    const iAsset = col(["asset name", "asset", "security"], [iAssetType]);
    const iType = col(["type", "transaction type", "action"], [iAssetType]);
    const iAmount = col(["amount"]);
    const iComment = col(["comment"]);

    // Not the transactions table.
    if (iDate < 0 || iAmount < 0 || iAsset < 0) return;

    $table.find("tbody tr").each((__, tr) => {
      const cells = $(tr)
        .find("td")
        .map((___, td) => $(td).text().replace(/\s+/g, " ").trim())
        .get();
      if (cells.length < 3) return;

      const at = (i: number) => (i >= 0 ? cells[i] ?? "" : "");

      const transactionDate = toIsoDate(at(iDate));
      const assetName = at(iAsset);
      if (!transactionDate || !assetName) return;

      const ticker = normalizeTicker(at(iTicker));
      const bracket = parseAmountRange(at(iAmount));
      const type = normalizeTradeType(at(iType));

      const base = {
        politicianId: context.politicianId,
        ticker,
        assetName,
        transactionDate,
        type,
        amountMin: bracket.min,
      };

      trades.push({
        id: `senate-${tradeKey(base)}`,
        politicianId: context.politicianId,
        politicianName: context.politicianName,
        chamber: "senate",
        party: "unknown", // eFD does not publish party.
        state: context.state,
        ticker,
        assetName,
        assetClass: inferAssetClass(`${assetName} ${at(iAssetType)}`, ticker),
        type,
        owner: normalizeOwner(at(iOwner)),
        transactionDate,
        disclosureDate: context.filedDate,
        filingDelayDays: daysBetween(transactionDate, context.filedDate),
        amountMin: bracket.min,
        amountMax: bracket.max,
        amountMid: bracketMidpoint(bracket.min, bracket.max),
        amountRange: bracket.label,
        source: "senate-efd",
        filingUrl: context.filingUrl,
        comment: at(iComment) || undefined,
      });
    });
  });

  return trades;
}

export interface SenateResult {
  trades: Trade[];
  filings: Filing[];
  roster: Politician[];
}

/**
 * Fetch recent Senate PTRs and their transaction rows.
 *
 * `maxReports` bounds how many report pages we open — each is a separate request
 * and eFD is slow, so the default stays modest and the server-side cache keeps
 * the 30s dashboard polling from re-fetching.
 */
export async function fetchSenateTrades(
  opts: { sinceDays?: number; maxReports?: number } = {},
): Promise<SenateResult> {
  const sinceDays = opts.sinceDays ?? 90;
  const maxReports = opts.maxReports ?? 25;

  const session = await openSession();
  const { rows } = await searchReports(session, { start: 0, length: 100, sinceDays });

  const filings: Filing[] = [];
  const rosterById = new Map<string, Politician>();

  const enriched = rows.map((row) => {
    const name = cleanPersonName(`${row.firstName} ${row.lastName}`.trim());
    const id = politicianId(name, "senate");
    const state = stateFromOffice(row.office);

    if (!rosterById.has(id)) {
      rosterById.set(id, {
        id,
        name,
        chamber: "senate",
        party: "unknown",
        state,
        role: "Senator",
        committees: [],
      });
    }

    filings.push({
      id: `senate-${row.reportPath ?? `${id}-${row.filedDate}`}`,
      politicianId: id,
      politicianName: name,
      chamber: "senate",
      state,
      filingType: row.reportTitle || "Periodic Transaction Report",
      filedDate: row.filedDate,
      year: Number(row.filedDate.slice(0, 4)) || new Date().getUTCFullYear(),
      documentUrl: row.reportPath,
      source: "senate-efd",
      // Paper filings are scanned images; only electronic PTRs have HTML rows.
      detailInPdfOnly: row.reportPath?.includes("/paper/") ?? false,
    });

    return { ...row, id, name, state };
  });

  // Only electronic PTRs have a parseable transactions table.
  const electronic = enriched
    .filter((r) => r.reportPath && !r.reportPath.includes("/paper/"))
    .slice(0, maxReports);

  const settled = await Promise.allSettled(
    electronic.map(async (row) => {
      const res = await httpFetch(row.reportPath!, {
        headers: { Accept: "text/html", Cookie: session.jar.header(), Referer: HOME },
      });
      if (!res.ok) throw new Error(`report ${row.reportPath} returned HTTP ${res.status}`);
      return parseSenatePtrHtml(await res.text(), {
        politicianId: row.id,
        politicianName: row.name,
        state: row.state,
        filedDate: row.filedDate,
        filingUrl: row.reportPath,
      });
    }),
  );

  const trades = settled
    .filter((r): r is PromiseFulfilledResult<Trade[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  filings.sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  return { trades, filings, roster: [...rosterById.values()] };
}
