/**
 * Web app entry point.
 *
 * Deploy → New deployment → Web app, "Execute as: Me", "Who has access: Anyone".
 * That gives a public https://script.google.com/macros/s/.../exec URL to share.
 *
 * The page never fetches upstream itself: it reads the snapshot the trigger
 * stored, so it renders immediately regardless of how slow the disclosure
 * sources are.
 */

function doGet(e) {
  var params = (e && e.parameter) || {};

  // A JSON mode is handy for debugging from outside the browser sandbox.
  if (params.api === 'snapshot') {
    return ContentService
      .createTextOutput(JSON.stringify(getSnapshotForClient()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var template = HtmlService.createTemplateFromFile('Index');
  // Deep links: ?view=asset&id=AAPL or ?view=politician&id=sen-jane-doe. In-page
  // navigation is client-side, so only the initial view comes from the URL.
  template.initialView = params.view || 'dashboard';
  template.initialId = params.id || '';
  template.pollMs = CONFIG.POLL_MS;

  return template.evaluate()
    .setTitle('Capitol Ledger — US political trading disclosures')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Let Index.html pull in the CSS and JS partials. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * The snapshot the page polls, called over google.script.run.
 *
 * Note it does NOT include `allTrades` — the client only needs summaries plus
 * the recent tape, and the RPC bridge has to serialise whatever we return.
 * Detail views ask for what they need separately.
 */
function getSnapshotForClient() {
  var snap = readSnapshot_();
  if (!snap) {
    return {
      dataState: 'cold',
      generatedAt: new Date().toISOString(),
      marketOpen: isUsMarketOpen(),
      stats: null, politicians: [], assets: [], recentTrades: [], recentFilings: [],
      sources: [],
      warnings: ['No snapshot stored yet. Run refreshSnapshot() once from the Apps Script ' +
                 'editor, or wait for the trigger to fire.']
    };
  }

  return {
    dataState: snap.dataState,
    generatedAt: snap.generatedAt,
    durationMs: snap.durationMs,
    marketOpen: snap.marketOpen,
    stats: snap.stats,
    politicians: snap.politicians,
    assets: snap.assets,
    recentTrades: snap.recentTrades,
    recentFilings: snap.recentFilings,
    sources: snap.sources,
    warnings: snap.warnings
  };
}

/** One filer, with their full transaction list and estimated positions. */
function getPoliticianForClient(id) {
  var snap = readSnapshot_();
  if (!snap) return null;

  var summary = null;
  for (var i = 0; i < snap.politicians.length; i++) {
    if (snap.politicians[i].id === id) { summary = snap.politicians[i]; break; }
  }
  if (!summary) return null;

  var trades = (snap.allTrades || []).filter(function (t) { return t.politicianId === id; });
  trades.sort(function (a, b) { return b.transactionDate.localeCompare(a.transactionDate); });

  var detail = JSON.parse(JSON.stringify(summary));
  detail.trades = trades;
  detail.holdings = buildHoldings(trades);
  return detail;
}

/** One asset, with price history, performance and everyone who traded it. */
function getAssetForClient(id) {
  var snap = readSnapshot_();
  if (!snap) return null;

  var summary = findAsset(snap.assets, id);
  if (!summary) return null;

  var trades = (snap.allTrades || []).filter(function (t) {
    return summary.ticker ? t.ticker === summary.ticker
                          : (!t.ticker && t.assetName === summary.name);
  });
  trades.sort(function (a, b) { return b.transactionDate.localeCompare(a.transactionDate); });

  // Price history exists only for listed tickers, and only when a real fetch
  // succeeds — there is no synthetic series to fall back on.
  var history = summary.ticker ? (fetchPriceHistory_(summary.ticker) || []) : [];

  var tierById = {};
  for (var i = 0; i < snap.politicians.length; i++) {
    tierById[snap.politicians[i].id] = snap.politicians[i].tier;
  }

  var detail = JSON.parse(JSON.stringify(summary));
  detail.quote = summary.ticker ? quoteFromHistory_(summary.ticker, summary.name, history) : null;
  detail.history = history;
  detail.performance = computePerformance(history);
  detail.traders = buildAssetTraders(trades, tierById, history);
  detail.trades = trades;
  return detail;
}

/** Let the page trigger a refresh by hand, for the "Refresh now" control. */
function refreshNowForClient() {
  refreshSnapshot();
  return getSnapshotForClient();
}
