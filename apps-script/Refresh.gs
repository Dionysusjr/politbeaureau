/**
 * Refresh orchestration.
 *
 * This runs on a TIME-DRIVEN TRIGGER, never inside a user's request. That split
 * matters more on Apps Script than it did on a server: a web app request that
 * waited on the House ZIP plus a Senate handshake would blow past any sensible
 * page load, and several readers would each pay that cost. Instead the trigger
 * refreshes on its own schedule and every visitor is served the stored
 * snapshot, so the page responds immediately no matter how slow the sources are.
 *
 * Every source runs independently: one dead upstream degrades the dashboard
 * rather than breaking it, and its failure is reported in the UI.
 *
 * There is NO simulator here. If nothing returns data the snapshot is empty and
 * says so, so a published page can never present invented filers as real.
 */

/** Priority order when two sources describe the same transaction. */
var SOURCE_PRIORITY_ = ['senate-efd', 'house-clerk', 'quiver', 'unusual-whales',
                        'fmp', 'finnhub'];

function priorityOf_(source) {
  var idx = SOURCE_PRIORITY_.indexOf(source);
  return idx < 0 ? SOURCE_PRIORITY_.length : idx;
}

/** Dedupe on the natural transaction key, keeping the best-ranked source. */
function mergeTrades(groups) {
  var byKey = {};
  for (var g = 0; g < groups.length; g++) {
    var list = groups[g] || [];
    for (var i = 0; i < list.length; i++) {
      var trade = list[i];
      // The id embeds a source prefix; strip it to compare the same underlying
      // transaction across providers.
      var key = String(trade.id).replace(/^[a-z-]+-/, '');
      var existing = byKey[key];
      if (!existing || priorityOf_(trade.source) < priorityOf_(existing.source)) {
        byKey[key] = trade;
      }
    }
  }

  var out = [];
  for (var k in byKey) if (byKey.hasOwnProperty(k)) out.push(byKey[k]);
  out.sort(function (a, b) {
    return b.disclosureDate.localeCompare(a.disclosureDate) || b.amountMid - a.amountMid;
  });
  return out;
}

function runSource_(id, label, fn) {
  var started = new Date().getTime();
  try {
    var result = fn() || {};
    return {
      id: id, label: label, ok: true,
      trades: result.trades || [], filings: result.filings || [], roster: result.roster || {},
      ms: new Date().getTime() - started, message: null
    };
  } catch (err) {
    return {
      id: id, label: label, ok: false,
      trades: [], filings: [], roster: {},
      ms: new Date().getTime() - started,
      message: err && err.message ? err.message : String(err)
    };
  }
}

/**
 * Fetch everything, assemble a snapshot, store it. Safe to run by hand from the
 * editor — that is also how you test your configuration.
 */
function refreshSnapshot() {
  var startedAt = new Date();
  var outcomes = [];

  if (isEnabled_('ENABLE_HOUSE_CLERK')) {
    outcomes.push(runSource_('house-clerk', 'House Clerk PTR index', fetchHouseFilings_));
  }
  if (isEnabled_('ENABLE_SENATE_EFD')) {
    outcomes.push(runSource_('senate-efd', 'Senate eFD', fetchSenateTrades_));
  }

  for (var a = 0; a < AGGREGATORS.length; a++) {
    var agg = AGGREGATORS[a];
    var key = getProp_(agg.keyProp);
    if (!key) continue;
    // Finnhub is symbol-scoped, so it runs last against tickers already seen.
    if (agg.id === 'finnhub') continue;
    outcomes.push(runSource_(agg.id, agg.label, (function (id, k) {
      return function () {
        if (id === 'quiver') return fetchQuiverTrades_(k);
        if (id === 'unusual-whales') return fetchUnusualWhalesTrades_(k);
        if (id === 'fmp') return fetchFmpTrades_(k);
        return { trades: [] };
      };
    })(agg.id, key)));
  }

  var groups = [];
  for (var o = 0; o < outcomes.length; o++) groups.push(outcomes[o].trades);
  var trades = mergeTrades(groups);

  // Finnhub enriches tickers the other sources surfaced.
  var finnhubKey = getProp_('FINNHUB_API_KEY');
  if (finnhubKey) {
    var seen = {};
    var symbols = [];
    for (var t = 0; t < trades.length && symbols.length < 25; t++) {
      if (trades[t].ticker && !seen[trades[t].ticker]) {
        seen[trades[t].ticker] = true;
        symbols.push(trades[t].ticker);
      }
    }
    var fh = runSource_('finnhub', 'Finnhub', function () {
      return fetchFinnhubTrades_(finnhubKey, symbols);
    });
    outcomes.push(fh);
    if (fh.trades.length) trades = mergeTrades([trades, fh.trades]);
  }

  if (trades.length > CONFIG.MAX_TRADES) trades = trades.slice(0, CONFIG.MAX_TRADES);

  // Roster metadata from whichever sources supplied it.
  var roster = {};
  var filings = [];
  var warnings = [];
  for (var i = 0; i < outcomes.length; i++) {
    var oc = outcomes[i];
    for (var id in oc.roster) if (oc.roster.hasOwnProperty(id) && !roster[id]) roster[id] = oc.roster[id];
    filings = filings.concat(oc.filings);
    if (!oc.ok && oc.message) warnings.push(oc.label + ': ' + oc.message);
  }
  filings.sort(function (x, y) { return y.filedDate.localeCompare(x.filedDate); });

  var politicians = buildPoliticians(trades, roster);
  var assets = buildAssets(trades);
  var stats = buildStats(trades, politicians, assets);

  var sources = [];
  for (var s = 0; s < outcomes.length; s++) {
    sources.push({
      id: outcomes[s].id, label: outcomes[s].label, ok: outcomes[s].ok,
      active: outcomes[s].ok && (outcomes[s].trades.length > 0 || outcomes[s].filings.length > 0),
      tradeCount: outcomes[s].trades.length,
      ms: outcomes[s].ms,
      message: outcomes[s].message,
      needsCredentials: false
    });
  }
  // Mention the aggregators that are available but switched off.
  for (var b = 0; b < AGGREGATORS.length; b++) {
    if (getProp_(AGGREGATORS[b].keyProp)) continue;
    sources.push({
      id: AGGREGATORS[b].id, label: AGGREGATORS[b].label, ok: true, active: false,
      tradeCount: 0, ms: 0, needsCredentials: true,
      message: 'Set ' + AGGREGATORS[b].keyProp + ' in Script properties to enable'
    });
  }

  if (trades.length === 0) {
    warnings.push('No source returned transaction-level disclosures. The House index is ' +
      'filing-level only (detail is inside each PDF); add an aggregator API key for ' +
      'ticker-level data.');
  }

  var snapshot = {
    generatedAt: startedAt.toISOString(),
    durationMs: new Date().getTime() - startedAt.getTime(),
    dataState: trades.length > 0 ? 'live' : 'empty',
    marketOpen: isUsMarketOpen(),
    stats: stats,
    politicians: politicians,
    assets: assets,
    recentTrades: trades.slice(0, 150),
    allTrades: trades,
    recentFilings: filings.slice(0, 60),
    sources: sources,
    warnings: warnings
  };

  var stored = storeSnapshot_(snapshot);
  Logger.log('Refresh complete: %s trades, %s filers, %s bytes in %s chunks, %sms',
    trades.length, politicians.length, stored.bytes, stored.cacheChunks, snapshot.durationMs);
  return snapshot;
}

/**
 * US equity regular session: 9:30am-4:00pm Eastern, Monday-Friday.
 * Market holidays are not modelled, so a holiday reads as open — this is a
 * session hint, not a trading calendar.
 */
function isUsMarketOpen() {
  var tz = 'America/New_York';
  var now = new Date();
  var day = Number(Utilities.formatDate(now, tz, 'u'));      // 1=Mon .. 7=Sun
  var minutes = Number(Utilities.formatDate(now, tz, 'H')) * 60 +
                Number(Utilities.formatDate(now, tz, 'm'));
  if (day >= 6) return false;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/**
 * Run once to install the refresh trigger. Safe to re-run: it clears any
 * trigger it previously created first, so you don't end up with duplicates
 * each quietly burning quota.
 */
function setupTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'refreshSnapshot') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('refreshSnapshot').timeBased().everyMinutes(10).create();
  Logger.log('Trigger installed: refreshSnapshot every 10 minutes.');
}
