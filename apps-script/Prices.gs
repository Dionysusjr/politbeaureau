/**
 * Price history for the asset view.
 *
 * stooq publishes free daily CSV with no key or registration, which suits a
 * script with no secret storage beyond Script Properties.
 *
 * There is NO synthetic fallback in this port: if a price can't be fetched the
 * asset simply has no chart. A published page must never show invented prices
 * as though they were market data.
 */

var PRICE_CACHE_PREFIX_ = 'price:';
var PRICE_TTL_SECONDS_ = 6 * 60 * 60;   // CacheService hard-caps at 6 hours
var TRADING_DAYS_ = 320;                 // ~15 months, so the 1Y window resolves

function priceSource_() {
  return getProp_('PRICE_DATA_SOURCE', 'stooq');
}

/**
 * Daily closes for a ticker, newest last. Returns null (not a fabricated
 * series) when prices are unavailable.
 */
function fetchPriceHistory_(ticker) {
  if (priceSource_() !== 'stooq') return null;

  var cache = CacheService.getScriptCache();
  var key = PRICE_CACHE_PREFIX_ + ticker;
  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* fall through and refetch */ }
  }

  var symbol = ticker.toLowerCase().replace(/\./g, '-') + '.us';
  var url = 'https://stooq.com/q/d/l/?s=' + encodeURIComponent(symbol) + '&i=d';

  var csv;
  try {
    csv = httpText_(url, { retries: 1 });
  } catch (err) {
    return null;
  }

  var lines = String(csv).trim().split(/\r?\n/);
  if (lines.length < 2 || !/date/i.test(lines[0])) return null;

  var points = [];
  for (var i = 1; i < lines.length; i++) {
    var cols = lines[i].split(',');
    var date = cols[0];
    var close = Number(cols[4]);
    if (!date || !isFinite(close) || close <= 0) continue;
    points.push({ date: date, close: Math.round(close * 100) / 100 });
  }
  if (!points.length) return null;

  points = points.slice(-TRADING_DAYS_);

  // A long series can exceed the 100KB per-key cache limit, so store a trimmed
  // copy rather than failing the write silently.
  try {
    cache.put(key, JSON.stringify(points), PRICE_TTL_SECONDS_);
  } catch (err) {
    try { cache.put(key, JSON.stringify(points.slice(-120)), PRICE_TTL_SECONDS_); } catch (e2) {}
  }
  return points;
}

/** Latest close and day-over-day change, derived from the series. */
function quoteFromHistory_(ticker, name, history) {
  if (!history || history.length === 0) return null;
  var last = history[history.length - 1];
  var prev = history.length > 1 ? history[history.length - 2] : last;
  var change = last.close - prev.close;
  return {
    ticker: ticker,
    name: name,
    price: last.close,
    previousClose: prev.close,
    change: Math.round(change * 100) / 100,
    changePct: prev.close > 0 ? (change / prev.close) * 100 : 0,
    currency: 'USD',
    isLive: true,
    asOf: last.date
  };
}
