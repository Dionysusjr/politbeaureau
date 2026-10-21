/**
 * Checks for the Apps Script port.
 *
 * Apps Script can't be executed outside Google, so the .gs files are loaded
 * into one shared scope here — exactly how the platform treats them — with
 * shims for the services they touch. That catches syntax errors, name
 * collisions between files, and logic regressions.
 *
 * This validates PARSING AND LOGIC, not live endpoint behaviour: upstream
 * markup and field names can still drift.
 *
 *   node test/verify.js      (from the apps-script directory)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shims = require('./shims');

const ROOT = path.join(__dirname, '..');
// Load order mirrors how Apps Script concatenates a project's files.
const FILES = ['Config.gs', 'Amounts.gs', 'Normalize.gs', 'Tiers.gs', 'Aggregate.gs',
               'Html.gs', 'Http.gs', 'Provider_House.gs', 'Provider_Senate.gs',
               'Provider_Aggregators.gs', 'Prices.gs', 'Store.gs', 'Refresh.gs'];

const sandbox = Object.assign({ console, Date, Math, JSON, RegExp, String, Number,
  Object, Array, isFinite, encodeURIComponent, decodeURIComponent, parseInt, parseFloat },
  shims);
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of FILES) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: file });
  } catch (err) {
    console.error(`\nFATAL: ${file} failed to load — ${err.message}`);
    process.exit(1);
  }
}

let checks = 0, failures = 0;
function test(name, fn) {
  checks++;
  try { fn(); console.log('  ok  ' + name); }
  catch (err) { failures++; console.error('  FAIL ' + name + '\n       ' + err.message); }
}
function section(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------------- */
section('Project loads');

test('every .gs file parses and shares one global scope', () => {
  // A name collision between files would silently shadow a function on the
  // real platform, so check a representative symbol from each.
  ['parseAmountRange', 'cleanPersonName', 'classifyTier', 'buildPoliticians',
   'extractTables_', 'httpFetch_', 'parseHouseIndexXml', 'parseSenatePtrHtml',
   'mapLooseTrade', 'fetchPriceHistory_', 'storeSnapshot_', 'refreshSnapshot']
    .forEach((fn) => assert.equal(typeof sandbox[fn], 'function', fn + ' missing'));
});

/* ---------------------------------------------------------------------- */
section('Amount brackets');

test('parses a standard filing range', () => {
  const b = sandbox.parseAmountRange('$1,001 - $15,000');
  assert.equal(b.min, 1001); assert.equal(b.max, 15000);
  assert.equal(b.label, '$1,001 - $15,000');
});

test('parses en-dash and em-dash ranges', () => {
  assert.equal(sandbox.parseAmountRange('$15,001–$50,000').max, 50000);
  assert.equal(sandbox.parseAmountRange('$50,001—$100,000').min, 50001);
});

test('parses the open-ended top bracket one dollar above its threshold', () => {
  const b = sandbox.parseAmountRange('Over $50,000,000');
  assert.equal(b.min, 50000001);
  assert.equal(b.label, 'Over $50,000,000');
});

test('parses a trailing-plus range inclusively', () => {
  assert.equal(sandbox.parseAmountRange('$1,000,001 +').min, 1000001);
});

test('snaps a bare single value onto its bracket', () => {
  const b = sandbox.parseAmountRange('$20,000');
  assert.equal(b.min, 15001); assert.equal(b.max, 50000);
});

test('treats a missing amount as undisclosed, not a zero-value trade', () => {
  assert.equal(sandbox.parseAmountRange(null).label, 'Undisclosed');
});

test('uses the floor, not an invented ceiling, for the open top bracket', () => {
  assert.equal(sandbox.bracketMidpoint(50000001, 100000000), 50000001);
  assert.equal(sandbox.bracketMidpoint(1001, 15000), 8001);
});

/* ---------------------------------------------------------------------- */
section('Normalisation');

test("normalises 'Last, First' into 'First Last'", () => {
  assert.equal(sandbox.cleanPersonName('Pelosi, Nancy'), 'Nancy Pelosi');
});

test('strips honorifics and suffixes', () => {
  assert.equal(sandbox.cleanPersonName('Hon.. Nancy Pelosi'), 'Nancy Pelosi');
  assert.equal(sandbox.cleanPersonName('Greene, Marjorie Taylor  (Mrs.)'), 'Marjorie Taylor Greene');
});

test('cleans tickers and rejects placeholders', () => {
  assert.equal(sandbox.normalizeTicker(' aapl '), 'AAPL');
  assert.equal(sandbox.normalizeTicker('$MSFT'), 'MSFT');
  assert.equal(sandbox.normalizeTicker('BRK.B'), 'BRK.B');
  assert.equal(sandbox.normalizeTicker('AAPL.US'), 'AAPL');
  assert.equal(sandbox.normalizeTicker('N/A'), null);
  assert.equal(sandbox.normalizeTicker('--'), null);
  assert.equal(sandbox.normalizeTicker('VERYLONGSYMBOL'), null);
});

test('parses the date formats filings use', () => {
  assert.equal(sandbox.toIsoDate('01/15/2025'), '2025-01-15');
  assert.equal(sandbox.toIsoDate('1/5/25'), '2025-01-05');
  assert.equal(sandbox.toIsoDate('2025-01-15'), '2025-01-15');
});

test('classifies transaction types including partial sales', () => {
  assert.equal(sandbox.normalizeTradeType('Purchase'), 'purchase');
  assert.equal(sandbox.normalizeTradeType('Sale (Partial)'), 'partial_sale');
  assert.equal(sandbox.normalizeTradeType('S'), 'sale');
  assert.equal(sandbox.normalizeTradeType('E'), 'exchange');
});

test('infers asset class from the disclosed description', () => {
  assert.equal(sandbox.inferAssetClass('Apple Inc. Common Stock', 'AAPL'), 'stock');
  assert.equal(sandbox.inferAssetClass('SPDR S&P 500 ETF Trust', 'SPY'), 'etf');
  assert.equal(sandbox.inferAssetClass('U.S. Treasury Bill, 26-week'), 'treasury');
  assert.equal(sandbox.inferAssetClass('California State GO Bond, Series 2031'), 'municipal_bond');
  assert.equal(sandbox.inferAssetClass('NVDA call option, strike $200', 'NVDA'), 'option');
  assert.equal(sandbox.inferAssetClass('Bitcoin (BTC) digital asset'), 'crypto');
  // An "index fund" must not be claimed by the ETF heuristics.
  assert.equal(sandbox.inferAssetClass('Vanguard 500 Index Fund mutual fund'), 'mutual_fund');
});

/* ---------------------------------------------------------------------- */
section('House Clerk index (XmlService)');

const HOUSE_XML = `<?xml version="1.0" encoding="utf-8"?>
<FinancialDisclosure>
  <Member><Prefix>Hon.</Prefix><Last>Doe</Last><First>Jane</First><Suffix></Suffix>
    <FilingType>P</FilingType><StateDst>CA11</StateDst><Year>2026</Year>
    <FilingDate>2/14/2026</FilingDate><DocID>20026001</DocID></Member>
  <Member><Prefix>Hon.</Prefix><Last>Roe</Last><First>Richard</First><Suffix>Jr.</Suffix>
    <FilingType>O</FilingType><StateDst>TX00</StateDst><Year>2026</Year>
    <FilingDate>5/15/2026</FilingDate><DocID>20026002</DocID></Member>
</FinancialDisclosure>`;

test('parses filings, filer names and state/district', () => {
  const { filings, roster } = sandbox.parseHouseIndexXml(HOUSE_XML, 2026);
  assert.equal(filings.length, 2);
  assert.equal(Object.keys(roster).length, 2);
  const ptr = filings.find((f) => f.filingTypeCode === 'P');
  assert.equal(ptr.politicianName, 'Jane Doe');
  assert.equal(ptr.filingType, 'Periodic Transaction Report');
  assert.equal(ptr.state, 'CA');
  assert.equal(ptr.district, 11);
  assert.equal(ptr.filedDate, '2026-02-14');
});

test('routes PTRs and annual reports to their different PDF paths', () => {
  const { filings } = sandbox.parseHouseIndexXml(HOUSE_XML, 2026);
  assert.match(filings.find((f) => f.filingTypeCode === 'P').documentUrl,
    /\/ptr-pdfs\/2026\/20026001\.pdf$/);
  assert.match(filings.find((f) => f.filingTypeCode === 'O').documentUrl,
    /\/financial-pdfs\/2026\/20026002\.pdf$/);
});

test('treats district 00 as at-large', () => {
  const { filings } = sandbox.parseHouseIndexXml(HOUSE_XML, 2026);
  const annual = filings.find((f) => f.filingTypeCode === 'O');
  assert.equal(annual.state, 'TX');
  assert.equal(annual.district, null);
});

test('flags House filings as PDF-only detail', () => {
  // The load-bearing limitation: the index carries no transaction rows.
  const { filings } = sandbox.parseHouseIndexXml(HOUSE_XML, 2026);
  assert.ok(filings.every((f) => f.detailInPdfOnly === true));
});

test('sorts filings newest-first', () => {
  assert.equal(sandbox.parseHouseIndexXml(HOUSE_XML, 2026).filings[0].filedDate, '2026-05-15');
});

test('reads only the XML entry out of an archive', () => {
  const blob = shims.fakeZipBlob([
    { name: '20026001.pdf', data: 'PDFPDFPDF' },
    { name: '2026FD.xml', data: HOUSE_XML }
  ], 2 * 1024 * 1024);
  const xml = sandbox.extractHouseIndexXml_(blob, '2026FD.zip');
  assert.ok(xml.includes('<Last>Doe</Last>'));
});

test('refuses an archive too large to buffer, with a diagnosable message', () => {
  // Utilities.unzip inflates every entry it is given, so an archive that also
  // carried the filing PDFs would blow the script's memory as an opaque crash.
  const blob = shims.fakeZipBlob([{ name: 'x.xml', data: '<a/>' }], 200 * 1024 * 1024);
  assert.throws(() => sandbox.extractHouseIndexXml_(blob, '2026FD.zip'), /over the 48MB cap/);
});

test('reports an archive with no index rather than returning undefined', () => {
  const blob = shims.fakeZipBlob([{ name: 'readme.txt', data: 'nope' }], 1024);
  assert.throws(() => sandbox.extractHouseIndexXml_(blob, '2026FD.zip'), /contained no XML index/);
});

/* ---------------------------------------------------------------------- */
section('Senate eFD PTR HTML (regex table parser)');

const SENATE_HTML = `<html><body>
<table class="table"><thead><tr><th>Unrelated</th></tr></thead>
<tbody><tr><td>ignore me</td></tr></tbody></table>
<table class="table table-striped">
  <thead><tr>
    <th>#</th><th>Transaction Date</th><th>Owner</th><th>Ticker</th>
    <th>Asset Name</th><th>Asset Type</th><th>Type</th><th>Amount</th><th>Comment</th>
  </tr></thead>
  <tbody>
    <tr><td>1</td><td>01/15/2026</td><td>Spouse</td><td>AAPL</td>
        <td>Apple Inc.</td><td>Stock</td><td>Purchase</td>
        <td>$1,001 - $15,000</td><td>--</td></tr>
    <tr><td>2</td><td>01/20/2026</td><td>Self</td><td>--</td>
        <td>U.S. Treasury Bill, 26-week</td><td>Treasury</td><td>Sale (Partial)</td>
        <td>$50,001 - $100,000</td><td>Matured</td></tr>
  </tbody>
</table></body></html>`;

const CTX = { politicianId: 'sen-jane-doe', politicianName: 'Jane Doe', state: 'VA',
              filedDate: '2026-02-01', filingUrl: 'https://efd.senate.gov/search/view/ptr/abc/' };

test('extracts transaction rows and ignores unrelated tables', () => {
  assert.equal(sandbox.parseSenatePtrHtml(SENATE_HTML, CTX).length, 2);
});

test('maps ticker, owner, type, class and bracket correctly', () => {
  const [buy, sale] = sandbox.parseSenatePtrHtml(SENATE_HTML, CTX);
  assert.equal(buy.ticker, 'AAPL');
  assert.equal(buy.owner, 'spouse');
  assert.equal(buy.type, 'purchase');
  assert.equal(buy.assetClass, 'stock');
  assert.equal(buy.amountMid, 8001);
  assert.equal(sale.ticker, null, "'--' must not become a ticker");
  assert.equal(sale.assetClass, 'treasury');
  assert.equal(sale.comment, 'Matured');
});

test('computes the filing delay from transaction to disclosure', () => {
  const [buy] = sandbox.parseSenatePtrHtml(SENATE_HTML, CTX);
  assert.equal(buy.transactionDate, '2026-01-15');
  assert.equal(buy.filingDelayDays, 17);
});

test("does not confuse the 'Asset Type' column with the 'Type' column", () => {
  // Both headers contain "type"; a substring search hits "Asset Type" first,
  // which reads the security's class as the direction and turns every sale
  // into a purchase.
  const [, sale] = sandbox.parseSenatePtrHtml(SENATE_HTML, CTX);
  assert.equal(sale.type, 'partial_sale');
});

test('survives a reordered column layout', () => {
  const reordered = SENATE_HTML
    .replace('<th>#</th><th>Transaction Date</th><th>Owner</th><th>Ticker</th>',
             '<th>#</th><th>Owner</th><th>Transaction Date</th><th>Ticker</th>')
    .replace('<td>1</td><td>01/15/2026</td><td>Spouse</td><td>AAPL</td>',
             '<td>1</td><td>Spouse</td><td>01/15/2026</td><td>AAPL</td>');
  const buy = sandbox.parseSenatePtrHtml(reordered, CTX).find((t) => t.ticker === 'AAPL');
  assert.equal(buy.transactionDate, '2026-01-15');
  assert.equal(buy.owner, 'spouse');
});

test('decodes HTML entities in cell text', () => {
  const html = SENATE_HTML.replace('Apple Inc.', 'Johnson &amp; Johnson');
  const buy = sandbox.parseSenatePtrHtml(html, CTX).find((t) => t.ticker === 'AAPL');
  assert.equal(buy.assetName, 'Johnson & Johnson');
});

/* ---------------------------------------------------------------------- */
section('Tolerant aggregator mapping');

test('maps snake_case payloads', () => {
  const [t] = sandbox.mapLooseTrades([{
    representative: 'Doe, Jane', ticker: 'MSFT', asset_description: 'Microsoft Corporation',
    transaction_date: '2026-03-04', disclosure_date: '2026-03-20', type: 'purchase',
    amount: '$15,001 - $50,000', party: 'Democrat', state: 'CA', chamber: 'house'
  }], 'quiver', 'house');
  assert.equal(t.politicianName, 'Jane Doe');
  assert.equal(t.ticker, 'MSFT');
  assert.equal(t.party, 'D');
  assert.equal(t.amountMin, 15001);
  assert.equal(t.filingDelayDays, 16);
});

test('maps camelCase and Title Case keys to the same fields', () => {
  const camel = sandbox.mapLooseTrades([{
    senator: 'Roe, Richard', symbol: 'nvda', assetName: 'NVIDIA Corporation',
    transactionDate: '2026-04-01', filingDate: '2026-04-10', transactionType: 'Sale',
    amountFrom: 50001, amountTo: 100000
  }], 'fmp', 'senate');
  const title = sandbox.mapLooseTrades([{
    'Representative': 'Roe, Richard', 'Ticker': 'NVDA', 'Asset Description': 'NVIDIA Corporation',
    'Transaction Date': '2026-04-01', 'Disclosure Date': '2026-04-10', 'Type': 'Sale',
    'Amount': '$50,001 - $100,000'
  }], 'fmp', 'senate');
  assert.equal(camel[0].ticker, 'NVDA');
  assert.equal(camel[0].type, 'sale');
  assert.equal(title[0].amountMin, camel[0].amountMin);
});

test('finds rows nested under data/results/trades wrappers', () => {
  const row = { name: 'Jane Doe', ticker: 'AAPL', assetName: 'Apple Inc.',
    transactionDate: '2026-05-01', disclosureDate: '2026-05-05', type: 'purchase',
    amount: '$1,001 - $15,000' };
  [[row], { data: [row] }, { results: [row] }, { trades: [row] }].forEach((payload) => {
    assert.equal(sandbox.mapLooseTrades(payload, 'quiver', 'house').length, 1);
  });
});

test('drops unusable rows instead of inventing zero-value trades', () => {
  const rows = [
    { ticker: 'AAPL', amount: '$1,001 - $15,000' },                    // no filer
    { representative: 'Jane Doe', amount: '$1,001 - $15,000' },        // no dates
    { representative: 'Jane Doe', transactionDate: '2026-01-01', ticker: 'AAPL' } // no amount
  ];
  assert.equal(sandbox.mapLooseTrades(rows, 'finnhub', 'house').length, 0);
});

/* ---------------------------------------------------------------------- */
section('Tiering and aggregation');

test('classifies each portfolio tier at its boundary', () => {
  assert.equal(sandbox.classifyTier(12000000), 'mega');
  assert.equal(sandbox.classifyTier(5000000), 'mega');
  assert.equal(sandbox.classifyTier(4999999), 'large');
  assert.equal(sandbox.classifyTier(1000000), 'large');
  assert.equal(sandbox.classifyTier(999999), 'medium');
  assert.equal(sandbox.classifyTier(250000), 'medium');
  assert.equal(sandbox.classifyTier(249999), 'small');
  assert.equal(sandbox.classifyTier(0), 'small');
});

function trade(over) {
  return Object.assign({
    id: 'x' + Math.random(), politicianId: 'hse-jane-doe', politicianName: 'Jane Doe',
    chamber: 'house', party: 'D', state: 'CA', ticker: 'AAPL', assetName: 'Apple Inc.',
    assetClass: 'stock', type: 'purchase', owner: 'self',
    transactionDate: '2026-01-15', disclosureDate: '2026-02-01', filingDelayDays: 17,
    amountMin: 1000001, amountMax: 5000000, amountMid: 3000001,
    amountRange: '$1,000,001 - $5,000,000', source: 'quiver'
  }, over);
}

test('ranks filers by estimated portfolio and assigns tiers', () => {
  const [first, second] = sandbox.buildPoliticians([
    trade({ politicianId: 'a', politicianName: 'Big Spender', amountMid: 6000000 }),
    trade({ politicianId: 'b', politicianName: 'Small Fry', amountMid: 8001, ticker: 'MSFT' })
  ], {});
  assert.equal(first.name, 'Big Spender');
  assert.equal(first.rank, 1);
  assert.equal(first.tier, 'mega');
  assert.equal(second.tier, 'small');
});

test('sales reduce the estimated portfolio, and it never goes negative', () => {
  const [p] = sandbox.buildPoliticians([
    trade({ amountMid: 3000001 }),
    trade({ type: 'sale', amountMid: 3000001 }),
    // A sale with no matching purchase means unknown basis, not negative value.
    trade({ type: 'sale', ticker: 'TSLA', assetName: 'Tesla, Inc.', amountMid: 5000000 })
  ], {});
  assert.equal(p.portfolioValue, 0);
  assert.equal(p.tier, 'small');
});

test("groups a ticker's derivatives with it but keeps the plain security name", () => {
  const assets = sandbox.buildAssets([
    trade({ ticker: 'SPY', assetName: 'SPDR S&P 500 ETF Trust', assetClass: 'etf' }),
    trade({ ticker: 'SPY', assetClass: 'option',
            assetName: 'SPDR S&P 500 ETF Trust put option, strike $600, expires 2026-12-18' })
  ]);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].name, 'SPDR S&P 500 ETF Trust',
    'an option description must not hijack the ticker name');
  assert.equal(assets[0].tradeCount, 2);
});

test('gives untickered assets a route-safe id', () => {
  const assets = sandbox.buildAssets([
    trade({ ticker: null, assetName: 'U.S. Treasury Bill, 26-week', assetClass: 'treasury' })
  ]);
  assert.equal(assets[0].id, 'n-u-s-treasury-bill-26-week');
  assert.match(assets[0].id, /^[a-z0-9-]+$/);
});

test('counts distinct politicians per asset, not trades', () => {
  const assets = sandbox.buildAssets([
    trade({ politicianId: 'a' }), trade({ politicianId: 'a' }),
    trade({ politicianId: 'b', party: 'R' })
  ]);
  assert.equal(assets[0].tradeCount, 3);
  assert.equal(assets[0].politicianCount, 2);
  assert.equal(assets[0].partySplit.D, 1);
  assert.equal(assets[0].partySplit.R, 1);
});

test('dedupes the same transaction across providers, preferring the primary source', () => {
  const merged = sandbox.mergeTrades([
    [trade({ id: 'quiver-hse-jane-doe|AAPL|2026-01-15|purchase|1000001', source: 'quiver' })],
    [trade({ id: 'senate-hse-jane-doe|AAPL|2026-01-15|purchase|1000001', source: 'senate-efd' })]
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'senate-efd');
});

test('computes performance windows, and reports null where history is short', () => {
  const history = [];
  for (let i = 400; i >= 0; i--) {
    history.push({ date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
                   close: 100 + (400 - i) * 0.1 });
  }
  const perf = sandbox.computePerformance(history);
  assert.equal(perf.length, 5);
  assert.ok(perf.every((p) => p.changePct !== null), 'full history should resolve every window');
  assert.ok(sandbox.computePerformance([]).every((p) => p.changePct === null));
});

/* ---------------------------------------------------------------------- */
section('Snapshot storage (chunked cache)');

test('round-trips a snapshot larger than the 100KB per-key cache limit', () => {
  const big = { dataState: 'live', politicians: [], assets: [], recentTrades: [] };
  for (let i = 0; i < 1500; i++) big.recentTrades.push(trade({ id: 'id-' + i }));
  const json = JSON.stringify(big);
  assert.ok(json.length > 100 * 1024, 'fixture must exceed one cache value to be meaningful');

  const stored = sandbox.storeSnapshot_(big);
  assert.ok(stored.cacheChunks > 1, 'should have split across chunks');
  const back = sandbox.readSnapshot_();
  assert.equal(back.recentTrades.length, 1500);
  assert.equal(back.dataState, 'live');
});

test('returns null when nothing has been stored, rather than throwing', () => {
  for (const k of Object.keys(shims._cache)) delete shims._cache[k];
  for (const k of Object.keys(shims._props)) delete shims._props[k];
  assert.equal(sandbox.readSnapshot_(), null);
});

/* ---------------------------------------------------------------------- */
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
