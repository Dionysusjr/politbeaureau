/**
 * Build a realistic snapshot fixture by running the project's OWN aggregation
 * over synthetic trades, so the shape is whatever refreshSnapshot() actually
 * produces rather than something hand-written that might drift from it.
 *
 * TEST ONLY. The shipped dashboard has no simulator — these filers are invented
 * purely to exercise the renderer, and the file never leaves test/.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shims = require('./shims');

const ROOT = path.join(__dirname, '..');
const FILES = ['Config.gs', 'Amounts.gs', 'Normalize.gs', 'Tiers.gs', 'Aggregate.gs',
               'Html.gs', 'Http.gs', 'Provider_House.gs', 'Provider_Senate.gs',
               'Provider_Aggregators.gs', 'Prices.gs', 'Store.gs', 'Refresh.gs'];

const sandbox = Object.assign({ console, Date, Math, JSON, RegExp, String, Number,
  Object, Array, isFinite, encodeURIComponent, decodeURIComponent, parseInt, parseFloat },
  shims);
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });

// Invented filers, spread so every tier is represented in the render.
const FILERS = [
  ['Eleanor Vance', 'senate', 'D', 'NY', null, 62],
  ['Marcus Whitfield', 'senate', 'R', 'TX', null, 48],
  ['Jordan Avery', 'house', 'D', 'CA', 12, 31],
  ['Priya Raghunathan', 'house', 'D', 'WA', 9, 18],
  ['Thomas Beaulieu', 'senate', 'R', 'LA', null, 11],
  ['Naomi Feldstein', 'house', 'D', 'MA', 5, 6.5],
  ['Victor Ramirez', 'house', 'R', 'AZ', 6, 3.2],
  ['Clara Nystrom', 'house', 'D', 'OR', 3, 0.9],
  ['Harold Ingram', 'senate', 'R', 'WY', null, 0.3]
];
const ASSETS = [
  ['AAPL', 'Apple Inc.', 'stock'], ['MSFT', 'Microsoft Corporation', 'stock'],
  ['NVDA', 'NVIDIA Corporation', 'stock'], ['SPY', 'SPDR S&P 500 ETF Trust', 'etf'],
  ['XOM', 'Exxon Mobil Corporation', 'stock'], ['LMT', 'Lockheed Martin Corporation', 'stock'],
  [null, 'U.S. Treasury Bill, 26-week', 'treasury'],
  [null, 'California State GO Bond, Series 2031', 'municipal_bond'],
  ['SPY', 'SPDR S&P 500 ETF Trust put option, strike $600, expires 2026-12-18', 'option']
];

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

const trades = [];
FILERS.forEach(([name, chamber, party, state, district, weight]) => {
  const id = sandbox.politicianId(name, chamber);
  const count = Math.max(3, Math.round(4 + 3 * Math.log10(weight * 10 + 1)));
  const per = (weight * 100000) / (count * 0.7 * 0.62);

  for (let i = 0; i < count; i++) {
    const [ticker, assetName, assetClass] = ASSETS[Math.floor(rnd() * ASSETS.length)];
    const sell = i > 2 && rnd() < 0.3;
    const txDays = Math.floor(Math.pow(rnd(), 1.6) * 400) + 2;
    const lag = Math.max(1, Math.round(3 + Math.pow(rnd(), 2) * 55));
    const target = per * (sell ? 0.75 : 1) * (0.55 + rnd() * 0.9);

    let bracket = sandbox.AMOUNT_BRACKETS[0], best = Infinity;
    sandbox.AMOUNT_BRACKETS.forEach((b) => {
      const d = Math.abs(Math.log(sandbox.bracketMidpoint(b.min, b.max) + 1) - Math.log(target + 1));
      if (d < best) { best = d; bracket = b; }
    });

    const type = sell ? (rnd() < 0.35 ? 'partial_sale' : 'sale') : 'purchase';
    const txDate = iso(txDays);
    const discDate = iso(Math.max(0, txDays - lag));
    const owner = ['self', 'self', 'spouse', 'joint', 'dependent'][Math.floor(rnd() * 5)];

    trades.push({
      id: 'fixture-' + sandbox.tradeKey({ politicianId: id, ticker, assetName,
        transactionDate: txDate, type, amountMin: bracket.min }) + '-' + i,
      politicianId: id, politicianName: name, chamber, party, state,
      ticker, assetName, assetClass, type, owner,
      transactionDate: txDate, disclosureDate: discDate,
      filingDelayDays: sandbox.daysBetween(txDate, discDate),
      amountMin: bracket.min, amountMax: bracket.max,
      amountMid: sandbox.bracketMidpoint(bracket.min, bracket.max),
      amountRange: bracket.label, source: 'fixture',
      filingUrl: 'https://example.invalid/filing', comment: null
    });
  }
});
trades.sort((a, b) => b.disclosureDate.localeCompare(a.disclosureDate));

const roster = {};
FILERS.forEach(([name, chamber, party, state, district]) => {
  roster[sandbox.politicianId(name, chamber)] = {
    id: sandbox.politicianId(name, chamber), name, chamber, party, state, district,
    role: chamber === 'senate' ? 'Senator' : 'Representative',
    committees: chamber === 'senate' ? ['Finance', 'Commerce'] : ['Financial Services']
  };
});

const politicians = sandbox.buildPoliticians(trades, roster);
const assets = sandbox.buildAssets(trades);
const stats = sandbox.buildStats(trades, politicians, assets);

// A price series so the chart renders, built deterministically.
const history = [];
let price = 232;
for (let i = 330; i >= 0; i--) {
  price = Math.max(5, price * (1 + (rnd() - 0.5) * 0.03));
  const d = new Date(Date.now() - i * 86400000);
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  history.push({ date: d.toISOString().slice(0, 10), close: Math.round(price * 100) / 100 });
}

const snapshot = {
  dataState: 'live',
  generatedAt: new Date(Date.now() - 42000).toISOString(),
  durationMs: 48213,
  marketOpen: true,
  stats, politicians, assets,
  recentTrades: trades.slice(0, 150),
  recentFilings: politicians.slice(0, 12).map((p, i) => ({
    id: 'f' + i, politicianId: p.id, politicianName: p.name, chamber: p.chamber,
    state: p.state, district: p.district,
    filingType: i % 3 === 0 ? 'Annual Report' : 'Periodic Transaction Report',
    filedDate: iso(i), year: 2026,
    documentUrl: 'https://example.invalid/doc.pdf',
    source: 'house-clerk', detailInPdfOnly: true
  })),
  sources: [
    { id: 'house-clerk', label: 'House Clerk PTR index', ok: true, active: true, tradeCount: 0, ms: 21400, message: null },
    { id: 'senate-efd', label: 'Senate eFD', ok: true, active: true, tradeCount: 38, ms: 24900, message: null },
    { id: 'quiver', label: 'Quiver Quantitative', ok: false, active: false, tradeCount: 0, ms: 1200, message: 'api.quiverquant.com returned HTTP 401' },
    { id: 'fmp', label: 'Financial Modeling Prep', ok: true, active: false, tradeCount: 0, ms: 0, needsCredentials: true, message: 'Set FMP_API_KEY in Script properties to enable' }
  ],
  warnings: []
};

const politicianDetail = (() => {
  const p = politicians[0];
  const own = trades.filter((t) => t.politicianId === p.id)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  return Object.assign({}, p, { trades: own, holdings: sandbox.buildHoldings(own) });
})();

const assetDetail = (() => {
  const a = assets.find((x) => x.ticker === 'AAPL') || assets[0];
  const own = trades.filter((t) => a.ticker ? t.ticker === a.ticker : t.assetName === a.name)
    .sort((x, y) => y.transactionDate.localeCompare(x.transactionDate));
  const tierById = {};
  politicians.forEach((p) => { tierById[p.id] = p.tier; });
  return Object.assign({}, a, {
    quote: sandbox.quoteFromHistory_(a.ticker, a.name, history),
    history,
    performance: sandbox.computePerformance(history),
    traders: sandbox.buildAssetTraders(own, tierById, history),
    trades: own
  });
})();

fs.writeFileSync(path.join(__dirname, 'fixture.json'),
  JSON.stringify({ snapshot, politicianDetail, assetDetail }, null, 1));

console.log('fixture: %d trades, %d filers, %d assets, tiers %s',
  trades.length, politicians.length, assets.length, JSON.stringify(stats.tierCounts));
console.log('snapshot payload: %d KB', Math.round(JSON.stringify(snapshot).length / 1024));
