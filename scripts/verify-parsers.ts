/**
 * Parser verification against fixtures.
 *
 * The disclosure endpoints this app talks to cannot be reached from every
 * environment (corporate egress policies commonly block *.house.gov / *.senate.gov,
 * and the commercial APIs need keys). That makes the *parsers* the part most
 * likely to be wrong and hardest to check — so they are exercised here against
 * fixtures modelled on each source's documented/observed shape.
 *
 * This validates parsing logic and normalisation, NOT live endpoint behaviour:
 * markup and field names upstream can still drift. Run with:
 *
 *   npm run verify:parsers
 */

import assert from "node:assert/strict";

import { parseHouseIndexXml } from "../lib/providers/house-clerk";
import { parseSenatePtrHtml } from "../lib/providers/senate-efd";
import { mapLooseTrades } from "../lib/providers/loose";
import { parseAmountRange, bracketMidpoint } from "../lib/amounts";
import { classifyTier } from "../lib/tiers";
import {
  cleanPersonName,
  inferAssetClass,
  normalizeTicker,
  normalizeTradeType,
  toIsoDate,
} from "../lib/normalize";
import { buildAssets, buildPoliticians } from "../lib/aggregate";
import { Trade } from "../lib/types";

let checks = 0;
let failures = 0;

function test(name: string, fn: () => void) {
  checks++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section("Amount brackets");

test("parses a standard filing range", () => {
  const b = parseAmountRange("$1,001 - $15,000");
  assert.equal(b.min, 1001);
  assert.equal(b.max, 15000);
  assert.equal(b.label, "$1,001 - $15,000");
});

test("parses en-dash and em-dash ranges", () => {
  assert.equal(parseAmountRange("$15,001–$50,000").max, 50000);
  assert.equal(parseAmountRange("$50,001—$100,000").min, 50001);
});

test("parses the open-ended top bracket", () => {
  const b = parseAmountRange("Over $50,000,000");
  assert.equal(b.min, 50000001);
  assert.equal(b.label, "Over $50,000,000");
});

test("parses a trailing-plus range", () => {
  assert.equal(parseAmountRange("$1,000,001 +").min, 1000001);
});

test("snaps a bare single value onto its bracket", () => {
  const b = parseAmountRange("$20,000");
  assert.equal(b.min, 15001);
  assert.equal(b.max, 50000);
});

test("treats missing amounts as undisclosed rather than zero-value trades", () => {
  const b = parseAmountRange(undefined);
  assert.equal(b.min, 0);
  assert.equal(b.label, "Undisclosed");
});

test("uses the floor, not an invented ceiling, for the open top bracket", () => {
  // Midpointing an open-ended bracket would inflate a filer's total on the
  // strength of a number nobody disclosed.
  assert.equal(bracketMidpoint(50000001, 100000000), 50000001);
  assert.equal(bracketMidpoint(1001, 15000), 8001);
});

// ---------------------------------------------------------------------------
section("Name / ticker / date normalisation");

test("normalises 'Last, First' into 'First Last'", () => {
  assert.equal(cleanPersonName("Pelosi, Nancy"), "Nancy Pelosi");
});

test("strips honorifics and suffixes", () => {
  assert.equal(cleanPersonName("Hon.. Nancy Pelosi"), "Nancy Pelosi");
  assert.equal(cleanPersonName("Greene, Marjorie Taylor  (Mrs.)"), "Marjorie Taylor Greene");
});

test("cleans tickers and rejects placeholders", () => {
  assert.equal(normalizeTicker(" aapl "), "AAPL");
  assert.equal(normalizeTicker("$MSFT"), "MSFT");
  assert.equal(normalizeTicker("BRK.B"), "BRK.B");
  assert.equal(normalizeTicker("AAPL.US"), "AAPL");
  assert.equal(normalizeTicker("N/A"), undefined);
  assert.equal(normalizeTicker("--"), undefined);
  assert.equal(normalizeTicker("VERYLONGSYMBOL"), undefined);
});

test("parses the date formats filings use", () => {
  assert.equal(toIsoDate("01/15/2025"), "2025-01-15");
  assert.equal(toIsoDate("1/5/25"), "2025-01-05");
  assert.equal(toIsoDate("2025-01-15"), "2025-01-15");
});

test("classifies transaction types including partial sales", () => {
  assert.equal(normalizeTradeType("Purchase"), "purchase");
  assert.equal(normalizeTradeType("Sale (Partial)"), "partial_sale");
  assert.equal(normalizeTradeType("S"), "sale");
  assert.equal(normalizeTradeType("P"), "purchase");
  assert.equal(normalizeTradeType("E"), "exchange");
});

test("infers asset class from the disclosed description", () => {
  assert.equal(inferAssetClass("Apple Inc. Common Stock", "AAPL"), "stock");
  assert.equal(inferAssetClass("SPDR S&P 500 ETF Trust", "SPY"), "etf");
  assert.equal(inferAssetClass("U.S. Treasury Bill, 26-week"), "treasury");
  assert.equal(inferAssetClass("California State GO Bond, Series 2031"), "municipal_bond");
  assert.equal(inferAssetClass("NVDA call option, strike $200", "NVDA"), "option");
  assert.equal(inferAssetClass("Bitcoin (BTC) digital asset"), "crypto");
  assert.equal(inferAssetClass("Vanguard 500 Index Fund mutual fund"), "mutual_fund");
});

// ---------------------------------------------------------------------------
section("House Clerk index XML");

// Modelled on the documented <YEAR>FD.xml schema inside <YEAR>FD.zip.
const HOUSE_XML = `<?xml version="1.0" encoding="utf-8"?>
<FinancialDisclosure>
  <Member>
    <Prefix>Hon.</Prefix>
    <Last>Doe</Last>
    <First>Jane</First>
    <Suffix></Suffix>
    <FilingType>P</FilingType>
    <StateDst>CA11</StateDst>
    <Year>2026</Year>
    <FilingDate>2/14/2026</FilingDate>
    <DocID>20026001</DocID>
  </Member>
  <Member>
    <Prefix>Hon.</Prefix>
    <Last>Roe</Last>
    <First>Richard</First>
    <Suffix>Jr.</Suffix>
    <FilingType>O</FilingType>
    <StateDst>TX00</StateDst>
    <Year>2026</Year>
    <FilingDate>5/15/2026</FilingDate>
    <DocID>20026002</DocID>
  </Member>
</FinancialDisclosure>`;

test("parses filings, filer names and state/district", () => {
  const { filings, roster } = parseHouseIndexXml(HOUSE_XML, 2026);
  assert.equal(filings.length, 2);
  assert.equal(roster.length, 2);

  const ptr = filings.find((f) => f.filingTypeCode === "P")!;
  assert.equal(ptr.politicianName, "Jane Doe");
  assert.equal(ptr.filingType, "Periodic Transaction Report");
  assert.equal(ptr.state, "CA");
  assert.equal(ptr.district, 11);
  assert.equal(ptr.filedDate, "2026-02-14");
});

test("routes PTRs and annual reports to their different PDF paths", () => {
  const { filings } = parseHouseIndexXml(HOUSE_XML, 2026);
  const ptr = filings.find((f) => f.filingTypeCode === "P")!;
  const annual = filings.find((f) => f.filingTypeCode === "O")!;
  assert.match(ptr.documentUrl!, /\/ptr-pdfs\/2026\/20026001\.pdf$/);
  assert.match(annual.documentUrl!, /\/financial-pdfs\/2026\/20026002\.pdf$/);
});

test("treats district 00 as at-large (no district number)", () => {
  const { filings } = parseHouseIndexXml(HOUSE_XML, 2026);
  const annual = filings.find((f) => f.filingTypeCode === "O")!;
  assert.equal(annual.state, "TX");
  assert.equal(annual.district, undefined);
});

test("flags House filings as PDF-only detail", () => {
  // This is the load-bearing limitation: the index carries no transaction rows.
  const { filings } = parseHouseIndexXml(HOUSE_XML, 2026);
  assert.ok(filings.every((f) => f.detailInPdfOnly === true));
});

test("sorts filings newest-first and tolerates empty input", () => {
  const { filings } = parseHouseIndexXml(HOUSE_XML, 2026);
  assert.equal(filings[0]!.filedDate, "2026-05-15");
  assert.deepEqual(parseHouseIndexXml("<FinancialDisclosure/>", 2026).filings, []);
});

// ---------------------------------------------------------------------------
section("Senate eFD PTR HTML");

const SENATE_HTML = `<html><body>
<h1>Periodic Transaction Report</h1>
<table class="table">
  <thead><tr><th>Some other table</th></tr></thead>
  <tbody><tr><td>ignore me</td></tr></tbody>
</table>
<table class="table table-striped">
  <thead>
    <tr>
      <th>#</th><th>Transaction Date</th><th>Owner</th><th>Ticker</th>
      <th>Asset Name</th><th>Asset Type</th><th>Type</th><th>Amount</th><th>Comment</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td><td>01/15/2026</td><td>Spouse</td><td>AAPL</td>
      <td>Apple Inc.</td><td>Stock</td><td>Purchase</td>
      <td>$1,001 - $15,000</td><td>--</td>
    </tr>
    <tr>
      <td>2</td><td>01/20/2026</td><td>Self</td><td>--</td>
      <td>U.S. Treasury Bill, 26-week</td><td>Treasury</td><td>Sale (Partial)</td>
      <td>$50,001 - $100,000</td><td>Matured</td>
    </tr>
  </tbody>
</table>
</body></html>`;

const SENATE_CONTEXT = {
  politicianId: "sen-jane-doe",
  politicianName: "Jane Doe",
  state: "VA",
  filedDate: "2026-02-01",
  filingUrl: "https://efd.senate.gov/search/view/ptr/abc/",
};

test("extracts transaction rows and ignores unrelated tables", () => {
  const trades = parseSenatePtrHtml(SENATE_HTML, SENATE_CONTEXT);
  assert.equal(trades.length, 2);
});

test("maps ticker, owner, type, class and bracket correctly", () => {
  const [buy, sale] = parseSenatePtrHtml(SENATE_HTML, SENATE_CONTEXT);
  assert.equal(buy!.ticker, "AAPL");
  assert.equal(buy!.owner, "spouse");
  assert.equal(buy!.type, "purchase");
  assert.equal(buy!.assetClass, "stock");
  assert.equal(buy!.amountMin, 1001);
  assert.equal(buy!.amountMax, 15000);
  assert.equal(buy!.amountMid, 8001);

  assert.equal(sale!.type, "partial_sale");
  assert.equal(sale!.ticker, undefined, "'--' must not become a ticker");
  assert.equal(sale!.assetClass, "treasury");
  assert.equal(sale!.comment, "Matured");
});

test("computes the filing delay from transaction to disclosure", () => {
  const [buy] = parseSenatePtrHtml(SENATE_HTML, SENATE_CONTEXT);
  assert.equal(buy!.transactionDate, "2026-01-15");
  assert.equal(buy!.disclosureDate, "2026-02-01");
  assert.equal(buy!.filingDelayDays, 17);
});

test("does not confuse the 'Asset Type' column with the 'Type' column", () => {
  // Both headers contain "type"; picking the wrong one turns every row into a
  // purchase regardless of what was filed.
  const [, sale] = parseSenatePtrHtml(SENATE_HTML, SENATE_CONTEXT);
  assert.equal(sale!.type, "partial_sale");
});

test("survives a reordered column layout", () => {
  const reordered = SENATE_HTML.replace(
    "<th>#</th><th>Transaction Date</th><th>Owner</th><th>Ticker</th>",
    "<th>#</th><th>Owner</th><th>Transaction Date</th><th>Ticker</th>",
  ).replace(
    "<td>1</td><td>01/15/2026</td><td>Spouse</td><td>AAPL</td>",
    "<td>1</td><td>Spouse</td><td>01/15/2026</td><td>AAPL</td>",
  );
  const trades = parseSenatePtrHtml(reordered, SENATE_CONTEXT);
  const buy = trades.find((t) => t.ticker === "AAPL")!;
  assert.equal(buy.transactionDate, "2026-01-15");
  assert.equal(buy.owner, "spouse");
});

// ---------------------------------------------------------------------------
section("Tolerant aggregator mapping");

test("maps snake_case payloads", () => {
  const rows = [
    {
      representative: "Doe, Jane",
      ticker: "MSFT",
      asset_description: "Microsoft Corporation",
      transaction_date: "2026-03-04",
      disclosure_date: "2026-03-20",
      type: "purchase",
      amount: "$15,001 - $50,000",
      party: "Democrat",
      state: "CA",
      chamber: "house",
    },
  ];
  const [t] = mapLooseTrades(rows, { source: "quiver" });
  assert.equal(t!.politicianName, "Jane Doe");
  assert.equal(t!.ticker, "MSFT");
  assert.equal(t!.party, "D");
  assert.equal(t!.chamber, "house");
  assert.equal(t!.amountMin, 15001);
  assert.equal(t!.filingDelayDays, 16);
  assert.equal(t!.source, "quiver");
});

test("maps camelCase and Title Case keys to the same fields", () => {
  const camel = mapLooseTrades(
    [
      {
        senator: "Roe, Richard",
        symbol: "nvda",
        assetName: "NVIDIA Corporation",
        transactionDate: "2026-04-01",
        filingDate: "2026-04-10",
        transactionType: "Sale",
        amountFrom: 50001,
        amountTo: 100000,
      },
    ],
    { source: "fmp" },
  );
  const title = mapLooseTrades(
    [
      {
        "Representative": "Roe, Richard",
        "Ticker": "NVDA",
        "Asset Description": "NVIDIA Corporation",
        "Transaction Date": "2026-04-01",
        "Disclosure Date": "2026-04-10",
        "Type": "Sale",
        "Amount": "$50,001 - $100,000",
      },
    ],
    { source: "fmp" },
  );

  assert.equal(camel[0]!.ticker, "NVDA");
  assert.equal(camel[0]!.type, "sale");
  assert.equal(camel[0]!.amountMin, 50001);
  assert.equal(title[0]!.amountMin, camel[0]!.amountMin);
  assert.equal(title[0]!.ticker, camel[0]!.ticker);
});

test("finds rows nested under data/results/trades wrappers", () => {
  const row = {
    name: "Jane Doe",
    ticker: "AAPL",
    assetName: "Apple Inc.",
    transactionDate: "2026-05-01",
    disclosureDate: "2026-05-05",
    type: "purchase",
    amount: "$1,001 - $15,000",
  };
  for (const payload of [[row], { data: [row] }, { results: [row] }, { trades: [row] }]) {
    assert.equal(mapLooseTrades(payload, { source: "lambda" }).length, 1);
  }
});

test("drops unusable rows instead of inventing zero-value trades", () => {
  const rows = [
    { ticker: "AAPL", amount: "$1,001 - $15,000" }, // no filer name
    { representative: "Jane Doe", amount: "$1,001 - $15,000" }, // no dates
    { representative: "Jane Doe", transactionDate: "2026-01-01", ticker: "AAPL" }, // no amount
  ];
  assert.equal(mapLooseTrades(rows, { source: "finnhub" }).length, 0);
});

test("handles a Finnhub-shaped row (amountFrom/amountTo, stamped symbol)", () => {
  const rows = [
    {
      symbol: "AAPL",
      amountFrom: 1001,
      amountTo: 15000,
      assetName: "Apple Inc",
      filingDate: "2026-02-01",
      transactionDate: "2026-01-15",
      name: "Jane Doe",
      transactionType: "Purchase",
      ownerType: "Spouse",
    },
  ];
  const [t] = mapLooseTrades(rows, { source: "finnhub" });
  assert.equal(t!.ticker, "AAPL");
  assert.equal(t!.owner, "spouse");
  assert.equal(t!.amountMid, 8001);
});

// ---------------------------------------------------------------------------
section("Tiering and aggregation");

test("classifies each portfolio tier at its boundary", () => {
  assert.equal(classifyTier(12_000_000), "mega");
  assert.equal(classifyTier(5_000_000), "mega");
  assert.equal(classifyTier(4_999_999), "large");
  assert.equal(classifyTier(1_000_000), "large");
  assert.equal(classifyTier(999_999), "medium");
  assert.equal(classifyTier(250_000), "medium");
  assert.equal(classifyTier(249_999), "small");
  assert.equal(classifyTier(0), "small");
});

function makeTrade(over: Partial<Trade>): Trade {
  return {
    id: Math.random().toString(36).slice(2),
    politicianId: "hse-jane-doe",
    politicianName: "Jane Doe",
    chamber: "house",
    party: "D",
    state: "CA",
    ticker: "AAPL",
    assetName: "Apple Inc.",
    assetClass: "stock",
    type: "purchase",
    owner: "self",
    transactionDate: "2026-01-15",
    disclosureDate: "2026-02-01",
    filingDelayDays: 17,
    amountMin: 1_000_001,
    amountMax: 5_000_000,
    amountMid: 3_000_001,
    amountRange: "$1,000,001 - $5,000,000",
    source: "simulated",
    ...over,
  };
}

test("ranks filers by estimated portfolio and assigns tiers", () => {
  const trades = [
    makeTrade({ politicianId: "a", politicianName: "Big Spender", amountMid: 6_000_000 }),
    makeTrade({ politicianId: "b", politicianName: "Small Fry", amountMid: 8_001, ticker: "MSFT" }),
  ];
  const [first, second] = buildPoliticians(trades, new Map());
  assert.equal(first!.name, "Big Spender");
  assert.equal(first!.rank, 1);
  assert.equal(first!.tier, "mega");
  assert.equal(second!.rank, 2);
  assert.equal(second!.tier, "small");
});

test("sales reduce the estimated portfolio, and it never goes negative", () => {
  const trades = [
    makeTrade({ amountMid: 3_000_001 }),
    makeTrade({ type: "sale", amountMid: 3_000_001 }),
    // A sale with no matching purchase means unknown basis, not negative value.
    makeTrade({ type: "sale", ticker: "TSLA", assetName: "Tesla, Inc.", amountMid: 5_000_000 }),
  ];
  const [p] = buildPoliticians(trades, new Map());
  assert.equal(p!.portfolioValue, 0);
  assert.equal(p!.tier, "small");
});

test("groups a ticker's derivatives with it but keeps the plain security name", () => {
  const assets = buildAssets([
    makeTrade({ ticker: "SPY", assetName: "SPDR S&P 500 ETF Trust", assetClass: "etf" }),
    makeTrade({
      ticker: "SPY",
      assetName: "SPDR S&P 500 ETF Trust put option, strike $600, expires 2026-12-18",
      assetClass: "option",
    }),
  ]);
  const spy = assets.find((a) => a.ticker === "SPY")!;
  assert.equal(assets.length, 1, "options should group under their underlying ticker");
  assert.equal(spy.name, "SPDR S&P 500 ETF Trust", "an option description must not hijack the name");
  assert.equal(spy.tradeCount, 2);
});

test("gives untickered assets a route-safe id", () => {
  const assets = buildAssets([
    makeTrade({ ticker: undefined, assetName: "U.S. Treasury Bill, 26-week", assetClass: "treasury" }),
  ]);
  assert.equal(assets[0]!.id, "n-u-s-treasury-bill-26-week");
  assert.match(assets[0]!.id, /^[a-z0-9-]+$/);
});

test("counts distinct politicians per asset, not trades", () => {
  const assets = buildAssets([
    makeTrade({ politicianId: "a" }),
    makeTrade({ politicianId: "a" }),
    makeTrade({ politicianId: "b", party: "R" }),
  ]);
  const aapl = assets[0]!;
  assert.equal(aapl.tradeCount, 3);
  assert.equal(aapl.politicianCount, 2);
  assert.equal(aapl.partySplit.D, 1);
  assert.equal(aapl.partySplit.R, 1);
});

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
