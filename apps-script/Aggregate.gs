/**
 * Aggregation: turn raw trades into ranked filers and asset summaries.
 * Pure functions — no Apps Script services — so they are testable off-platform.
 */

function isBuy(t) {
  return t.type === 'purchase' || t.type === 'exchange';
}

/**
 * Grouping key for an asset. Tickered securities group by ticker — including
 * their derivatives, so a ticker's page shows every disclosed position in that
 * name. Untickered assets group on a route-safe slug of their description.
 */
function assetKey(t) {
  return t.ticker || ('n-' + slugify(t.assetName).slice(0, 48));
}

/**
 * Estimated portfolio value for a filer.
 *
 * Disclosures give brackets per *transaction*, not a portfolio statement, so we
 * estimate size as net retained disclosed flow (purchases minus sales), floored
 * at zero per position — a filer who sold more than we ever saw them buy has an
 * unknown basis, not a negative portfolio. The UI labels it an estimate.
 */
function estimatePortfolio_(trades) {
  var byAsset = {};
  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    var key = assetKey(t);
    if (!byAsset[key]) byAsset[key] = { mid: 0, min: 0, max: 0 };
    var sign = isBuy(t) ? 1 : -1;
    byAsset[key].mid += sign * t.amountMid;
    byAsset[key].min += sign * t.amountMin;
    byAsset[key].max += sign * t.amountMax;
  }

  var value = 0, min = 0, max = 0;
  for (var k in byAsset) {
    if (!byAsset.hasOwnProperty(k)) continue;
    value += Math.max(0, byAsset[k].mid);
    min += Math.max(0, byAsset[k].min);
    max += Math.max(0, byAsset[k].max);
  }
  return { value: Math.round(value), min: Math.round(min), max: Math.round(max) };
}

function buildHoldings(trades) {
  var map = {};
  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    var key = assetKey(t);
    if (!map[key]) {
      map[key] = {
        ticker: t.ticker || null, assetName: t.assetName, assetClass: t.assetClass,
        netValue: 0, purchaseValue: 0, saleValue: 0, tradeCount: 0,
        lastTradeDate: t.transactionDate
      };
    }
    var h = map[key];
    if (isBuy(t)) { h.purchaseValue += t.amountMid; h.netValue += t.amountMid; }
    else { h.saleValue += t.amountMid; h.netValue -= t.amountMid; }
    h.tradeCount += 1;
    if (t.transactionDate > h.lastTradeDate) h.lastTradeDate = t.transactionDate;
  }

  var out = [];
  for (var k in map) if (map.hasOwnProperty(k)) out.push(map[k]);
  out.sort(function (a, b) { return b.netValue - a.netValue; });
  return out;
}

/**
 * Build ranked filer summaries. `roster` maps id -> metadata (chamber, party,
 * state); filers present in the trades but missing from the roster still appear,
 * using whatever the trade record carried.
 */
function buildPoliticians(trades, roster) {
  roster = roster || {};
  var grouped = {};
  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    if (!grouped[t.politicianId]) grouped[t.politicianId] = [];
    grouped[t.politicianId].push(t);
  }

  var summaries = [];
  for (var id in grouped) {
    if (!grouped.hasOwnProperty(id)) continue;
    var list = grouped[id];
    var first = list[0];
    var meta = roster[id] || {};
    var portfolio = estimatePortfolio_(list);
    var holdings = buildHoldings(list);

    var buyValue = 0, sellValue = 0, purchaseCount = 0, saleCount = 0;
    var classTotals = {}, assetKeys = {}, delays = 0;
    var dates = [];

    for (var j = 0; j < list.length; j++) {
      var tr = list[j];
      if (isBuy(tr)) { buyValue += tr.amountMid; purchaseCount += 1; }
      else { sellValue += tr.amountMid; saleCount += 1; }
      classTotals[tr.assetClass] = (classTotals[tr.assetClass] || 0) + tr.amountMid;
      assetKeys[assetKey(tr)] = true;
      delays += tr.filingDelayDays;
      dates.push(tr.transactionDate);
    }
    dates.sort();

    var mix = [];
    for (var cls in classTotals) {
      if (classTotals.hasOwnProperty(cls)) mix.push({ assetClass: cls, value: Math.round(classTotals[cls]) });
    }
    mix.sort(function (a, b) { return b.value - a.value; });

    summaries.push({
      id: id,
      name: meta.name || first.politicianName,
      chamber: meta.chamber || first.chamber,
      party: meta.party || first.party,
      state: meta.state || first.state,
      district: meta.district || null,
      role: meta.role || (first.chamber === 'senate' ? 'Senator' : 'Representative'),
      committees: meta.committees || [],
      portfolioValue: portfolio.value,
      portfolioValueMin: portfolio.min,
      portfolioValueMax: portfolio.max,
      tier: classifyTier(portfolio.value),
      rank: 0,
      tradeCount: list.length,
      purchaseCount: purchaseCount,
      saleCount: saleCount,
      buyValue: Math.round(buyValue),
      sellValue: Math.round(sellValue),
      uniqueAssets: Object.keys(assetKeys).length,
      topAssets: holdings.slice(0, 5).map(function (h) {
        return { ticker: h.ticker, assetName: h.assetName, value: Math.round(h.netValue) };
      }),
      assetClassMix: mix,
      lastTradeDate: dates.length ? dates[dates.length - 1] : null,
      avgFilingDelayDays: list.length ? Math.round(delays / list.length) : 0
    });
  }

  summaries.sort(function (a, b) {
    return (b.portfolioValue - a.portfolioValue) || a.name.localeCompare(b.name);
  });
  for (var r = 0; r < summaries.length; r++) summaries[r].rank = r + 1;
  return summaries;
}

/**
 * Pick the display name for an asset several filings describe differently.
 *
 * Derivatives are reported under the underlying's ticker ("SPY put option,
 * strike $600, expires…"), so first-seen naming lets an option description
 * hijack the whole ticker. Prefer the shortest plain-security description.
 */
function preferredAssetName_(names) {
  var derivative = /option|call\b|put\b|strike|expir|warrant/i;
  var plain = names.filter(function (n) { return !derivative.test(n); });
  var pool = plain.length ? plain : names;
  return pool.slice().sort(function (a, b) {
    return a.length - b.length || a.localeCompare(b);
  })[0];
}

function buildAssets(trades) {
  var map = {};
  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    var key = assetKey(t);
    if (!map[key]) {
      map[key] = {
        id: t.ticker || key, ticker: t.ticker || null, name: t.assetName,
        assetClass: t.assetClass, buyValue: 0, sellValue: 0, netValue: 0,
        tradeCount: 0, purchaseCount: 0, saleCount: 0,
        politicians: {}, buyers: {}, sellers: {}, parties: { D: {}, R: {}, I: {} },
        names: [], classCounts: {}, lastTradeDate: t.transactionDate
      };
    }
    var e = map[key];
    e.names.push(t.assetName);
    e.classCounts[t.assetClass] = (e.classCounts[t.assetClass] || 0) + 1;

    if (isBuy(t)) {
      e.buyValue += t.amountMid; e.netValue += t.amountMid;
      e.purchaseCount += 1; e.buyers[t.politicianId] = true;
    } else {
      e.sellValue += t.amountMid; e.netValue -= t.amountMid;
      e.saleCount += 1; e.sellers[t.politicianId] = true;
    }
    e.tradeCount += 1;
    e.politicians[t.politicianId] = true;
    if (e.parties[t.party]) e.parties[t.party][t.politicianId] = true;
    if (t.transactionDate > e.lastTradeDate) e.lastTradeDate = t.transactionDate;
  }

  var out = [];
  for (var k in map) {
    if (!map.hasOwnProperty(k)) continue;
    var a = map[k];
    var dominant = a.assetClass, best = 0;
    for (var cls in a.classCounts) {
      if (a.classCounts.hasOwnProperty(cls) && a.classCounts[cls] > best) {
        best = a.classCounts[cls]; dominant = cls;
      }
    }
    out.push({
      id: a.id, ticker: a.ticker, name: preferredAssetName_(a.names), assetClass: dominant,
      buyValue: Math.round(a.buyValue), sellValue: Math.round(a.sellValue),
      netValue: Math.round(a.netValue), tradeCount: a.tradeCount,
      purchaseCount: a.purchaseCount, saleCount: a.saleCount,
      politicianCount: Object.keys(a.politicians).length,
      buyerCount: Object.keys(a.buyers).length,
      sellerCount: Object.keys(a.sellers).length,
      partySplit: {
        D: Object.keys(a.parties.D).length,
        R: Object.keys(a.parties.R).length,
        I: Object.keys(a.parties.I).length
      },
      lastTradeDate: a.lastTradeDate
    });
  }
  out.sort(function (x, y) { return y.buyValue - x.buyValue; });
  return out;
}

/** Per-filer rollup for a single asset, used by the asset view. */
function buildAssetTraders(trades, tierById, history) {
  var map = {};
  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    if (!map[t.politicianId]) {
      map[t.politicianId] = {
        politicianId: t.politicianId, politicianName: t.politicianName,
        chamber: t.chamber, party: t.party, state: t.state,
        tier: tierById[t.politicianId] || 'small',
        buyValue: 0, sellValue: 0, netValue: 0, tradeCount: 0,
        firstTradeDate: t.transactionDate, lastTradeDate: t.transactionDate,
        firstBuyDate: null
      };
    }
    var e = map[t.politicianId];
    if (isBuy(t)) {
      e.buyValue += t.amountMid; e.netValue += t.amountMid;
      if (!e.firstBuyDate || t.transactionDate < e.firstBuyDate) e.firstBuyDate = t.transactionDate;
    } else {
      e.sellValue += t.amountMid; e.netValue -= t.amountMid;
    }
    e.tradeCount += 1;
    if (t.transactionDate < e.firstTradeDate) e.firstTradeDate = t.transactionDate;
    if (t.transactionDate > e.lastTradeDate) e.lastTradeDate = t.transactionDate;
  }

  var latest = history && history.length ? history[history.length - 1].close : null;
  var out = [];
  for (var k in map) {
    if (!map.hasOwnProperty(k)) continue;
    var e2 = map[k];
    var ret = null;
    if (e2.firstBuyDate && latest && history.length > 1) {
      for (var h = 0; h < history.length; h++) {
        if (history[h].date >= e2.firstBuyDate) {
          if (history[h].close > 0) ret = ((latest - history[h].close) / history[h].close) * 100;
          break;
        }
      }
    }
    out.push({
      politicianId: e2.politicianId, politicianName: e2.politicianName,
      chamber: e2.chamber, party: e2.party, state: e2.state, tier: e2.tier,
      buyValue: Math.round(e2.buyValue), sellValue: Math.round(e2.sellValue),
      netValue: Math.round(e2.netValue), tradeCount: e2.tradeCount,
      firstTradeDate: e2.firstTradeDate, lastTradeDate: e2.lastTradeDate,
      returnSinceFirstBuyPct: ret
    });
  }
  out.sort(function (a, b) { return b.buyValue - a.buyValue; });
  return out;
}

function buildStats(trades, politicians, assets) {
  var today = new Date().toISOString().slice(0, 10);
  var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  var tierCounts = { mega: 0, large: 0, medium: 0, small: 0 };
  for (var i = 0; i < politicians.length; i++) tierCounts[politicians[i].tier] += 1;

  var buyValue = 0, sellValue = 0, delays = 0, newThisWeek = 0;
  for (var j = 0; j < trades.length; j++) {
    var t = trades[j];
    if (isBuy(t)) buyValue += t.amountMid; else sellValue += t.amountMid;
    delays += t.filingDelayDays;
    if (t.disclosureDate >= weekAgo && t.disclosureDate <= today) newThisWeek += 1;
  }

  return {
    totalTrades: trades.length,
    totalDisclosedValue: Math.round(buyValue + sellValue),
    buyValue: Math.round(buyValue),
    sellValue: Math.round(sellValue),
    politicianCount: politicians.length,
    assetCount: assets.length,
    newThisWeek: newThisWeek,
    avgFilingDelayDays: trades.length ? Math.round(delays / trades.length) : 0,
    tierCounts: tierCounts
  };
}

/** Percent change over standard windows, derived from a daily close series. */
function computePerformance(history) {
  var windows = [
    { label: '1W', days: 7 }, { label: '1M', days: 30 }, { label: '3M', days: 90 },
    { label: '6M', days: 182 }, { label: '1Y', days: 365 }
  ];
  if (!history || !history.length) {
    return windows.map(function (w) { return { label: w.label, changePct: null }; });
  }
  var latest = history[history.length - 1];

  return windows.map(function (w) {
    var cutoff = new Date(Date.parse(latest.date) - w.days * 86400000).toISOString().slice(0, 10);
    var past = null;
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].date <= cutoff) { past = history[i]; break; }
    }
    if (!past || past.close <= 0 || past.date === latest.date) {
      return { label: w.label, changePct: null };
    }
    return { label: w.label, changePct: ((latest.close - past.close) / past.close) * 100 };
  });
}

/** Resolve an asset id (ticker or name slug) back to its asset. */
function findAsset(assets, key) {
  var raw = String(key);
  var i;
  for (i = 0; i < assets.length; i++) if (assets[i].id === raw) return assets[i];
  for (i = 0; i < assets.length; i++) if (assets[i].id.toUpperCase() === raw.toUpperCase()) return assets[i];
  for (i = 0; i < assets.length; i++) if (assets[i].ticker === raw.toUpperCase()) return assets[i];
  for (i = 0; i < assets.length; i++) if (assets[i].name.toLowerCase() === raw.toLowerCase()) return assets[i];
  return null;
}
