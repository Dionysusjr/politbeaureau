/**
 * Normalisation shared by every provider, so records arriving from a House XML
 * index, a Senate HTML table and a JSON aggregator all collapse onto the same
 * shape and the same dedupe key.
 */

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stable filer id that survives small formatting differences. */
function politicianId(name, chamber) {
  return chamber.slice(0, 3) + '-' + slugify(cleanPersonName(name));
}

/**
 * Filings render names inconsistently ("Hon.. Nancy Pelosi", "Pelosi, Nancy",
 * "Greene, Marjorie Taylor  (Mrs.)"). Collapse to "First Last".
 */
function cleanPersonName(raw) {
  var name = String(raw).replace(/\s+/g, ' ').trim();
  name = name.replace(/^(hon\.*|mr\.|mrs\.|ms\.|dr\.|rep\.|sen\.|senator|representative)\s+/gi, '');
  name = name.replace(/\s*\((?:mr|mrs|ms|dr|jr|sr|self|spouse)\.?\)\s*$/gi, '');
  name = name.replace(/,\s*(jr|sr|ii|iii|iv)\.?$/gi, '');

  var comma = name.match(/^([^,]+),\s*(.+)$/);
  if (comma) name = comma[2].trim() + ' ' + comma[1].trim();

  return name.replace(/\s+/g, ' ').trim();
}

/** Uppercase, strip exchange suffixes and the junk filings append to tickers. */
function normalizeTicker(raw) {
  if (!raw) return null;
  var t = String(raw).toUpperCase().trim();
  t = t.replace(/^\$/, '');
  t = t.replace(/\s*\(.*\)\s*$/, '');
  t = t.replace(/\.(US|N|O|OQ|K)$/i, '');
  t = t.replace(/[^A-Z0-9.\-]/g, '');
  if (!t || t.length > 8) return null;
  if (['NA', 'N/A', 'NONE', '--', '-', 'UNKNOWN'].indexOf(t) >= 0) return null;
  return t;
}

var TRADE_TYPE_MAP_ = [
  [/partial\s*sale|sale\s*\(?\s*partial|sale_partial|^sp$/i, 'partial_sale'],
  [/exchange|^e$/i, 'exchange'],
  [/sale|sell|sold|divest|^s$|^sf$/i, 'sale'],
  [/purchase|buy|bought|acquis|^p$/i, 'purchase']
];

function normalizeTradeType(raw) {
  var text = String(raw == null ? '' : raw).trim();
  for (var i = 0; i < TRADE_TYPE_MAP_.length; i++) {
    if (TRADE_TYPE_MAP_[i][0].test(text)) return TRADE_TYPE_MAP_[i][1];
  }
  return 'purchase';
}

function normalizeOwner(raw) {
  var t = String(raw == null ? '' : raw).toLowerCase();
  if (/spouse|sp\b/.test(t)) return 'spouse';
  if (/joint|jt\b/.test(t)) return 'joint';
  if (/depend|child|dc\b/.test(t)) return 'dependent';
  if (/self|filer|own/.test(t)) return 'self';
  return 'unknown';
}

function normalizeParty(raw) {
  var t = String(raw == null ? '' : raw).trim().toLowerCase();
  if (/^d|democrat/.test(t)) return 'D';
  if (/^r|republic/.test(t)) return 'R';
  if (/^i|independ/.test(t)) return 'I';
  return 'unknown';
}

function normalizeChamber(raw) {
  var t = String(raw == null ? '' : raw).toLowerCase();
  if (/senat/.test(t)) return 'senate';
  if (/house|represent/.test(t)) return 'house';
  if (/exec|cabinet|president|agency/.test(t)) return 'executive';
  return 'house';
}

/**
 * Infer asset class from the disclosed description. Filings are free text, so
 * this is keyword-based and deliberately conservative: anything unrecognised
 * with a ticker is a stock, without one it is "other".
 */
function inferAssetClass(assetName, ticker) {
  var t = String(assetName).toLowerCase();

  if (/\b(call|put)\b|option|strike|expir/.test(t)) return 'option';
  if (/bitcoin|ethereum|crypto|coinbase wallet|\bbtc\b|\beth\b|digital asset/.test(t)) return 'crypto';
  if (/municipal|muni bond|\bgo bond\b|school district|revenue bond/.test(t)) return 'municipal_bond';
  if (/treasury|t-bill|tbill|t-note|savings bond|\bus\s*gov.*bond|sovereign/.test(t)) return 'treasury';
  if (/corporate bond|\bnote due\b|debenture|\bbond\b/.test(t)) return 'corporate_bond';
  // "Mutual fund" is an explicit, unambiguous label — check it before the ETF
  // heuristics, which would otherwise claim anything called an "index fund".
  if (/mutual fund/.test(t)) return 'mutual_fund';
  if (/\betf\b|exchange[- ]traded|\bishares\b|\bspdr\b|\bqqq\b|index trust/.test(t)) return 'etf';
  if (/index fund|\bfund\b|money market|\bira\b|401\(?k\)?/.test(t)) return 'mutual_fund';
  if (/\breit\b|real estate invest/.test(t)) return 'reit';
  if (/\bipo\b|initial public offering/.test(t)) return 'ipo';
  if (/stock|common shares|common stock|ordinary shares|class [ab] shares/.test(t)) return 'stock';

  return ticker ? 'stock' : 'other';
}

var ASSET_CLASS_LABEL = {
  stock: 'Stock', etf: 'ETF', mutual_fund: 'Mutual fund',
  corporate_bond: 'Corporate bond', municipal_bond: 'Municipal bond',
  treasury: 'Treasury', option: 'Option', crypto: 'Crypto',
  reit: 'REIT', ipo: 'IPO', other: 'Other'
};

var TRADE_TYPE_LABEL = {
  purchase: 'Purchase', sale: 'Sale', partial_sale: 'Partial sale', exchange: 'Exchange'
};

var OWNER_LABEL = {
  self: 'Self', spouse: 'Spouse', joint: 'Joint', dependent: 'Dependent', unknown: '—'
};

/** Whole days between two ISO dates, floored at 0. */
function daysBetween(fromIso, toIso) {
  var from = Date.parse(fromIso);
  var to = Date.parse(toIso);
  if (!isFinite(from) || !isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
}

/** Coerce the many date formats filings use into ISO yyyy-mm-dd. */
function toIsoDate(raw) {
  if (!raw) return null;
  var text = String(raw).trim();

  var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

  var us = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (us) {
    var year = us[3].length === 2 ? '20' + us[3] : us[3];
    return year + '-' + padTwo_(us[1]) + '-' + padTwo_(us[2]);
  }

  var parsed = Date.parse(text);
  if (isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function padTwo_(v) {
  var s = String(v);
  return s.length >= 2 ? s : '0' + s;
}

/**
 * Dedupe key for a trade. Two providers reporting the same filing must collapse
 * to one record, so the key uses only fields every source supplies.
 */
function tradeKey(parts) {
  var asset = parts.ticker || slugify(parts.assetName).slice(0, 32);
  return [parts.politicianId, asset, parts.transactionDate, parts.type, parts.amountMin].join('|');
}
