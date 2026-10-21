/**
 * Commercial aggregator providers.
 *
 * These sit behind API keys and do the expensive part — extracting transaction
 * rows out of House PTR PDFs — so they are the practical way to get
 * ticker-level House data. Each is enabled purely by its key being present in
 * Script Properties.
 *
 * Because their exact response shapes sit behind paywalls and change, all of
 * them pipe through ONE tolerant field mapper rather than six brittle schemas.
 * A vendor renaming `transaction_date` degrades one field instead of breaking
 * the integration.
 */

var AGGREGATORS = [
  { id: 'quiver',          label: 'Quiver Quantitative',    keyProp: 'QUIVER_API_KEY' },
  { id: 'unusual-whales',  label: 'Unusual Whales',         keyProp: 'UNUSUAL_WHALES_API_KEY' },
  { id: 'fmp',             label: 'Financial Modeling Prep', keyProp: 'FMP_API_KEY' },
  { id: 'finnhub',         label: 'Finnhub',                keyProp: 'FINNHUB_API_KEY' }
];

/** Normalise a record's keys once so casing/punctuation variants all match. */
function flattenKeys_(row) {
  var flat = {};
  for (var k in row) {
    if (!row.hasOwnProperty(k)) continue;
    flat[String(k).toLowerCase().replace(/[^a-z0-9]/g, '')] = row[k];
  }
  return flat;
}

function pickField_(flat, names) {
  for (var i = 0; i < names.length; i++) {
    var key = names[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    var v = flat[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function asString_(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function asNumber_(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    var n = Number(v.replace(/[^0-9.\-]/g, ''));
    if (isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Map one loosely-shaped aggregator record onto a Trade.
 * Returns null when the minimum viable set is missing, so a thin row is dropped
 * rather than becoming a zero-value trade.
 */
function mapLooseTrade(row, source, defaultChamber) {
  var flat = flattenKeys_(row);

  var name = asString_(pickField_(flat, ['representative', 'senator', 'politician', 'member',
    'memberName', 'filer', 'filerName', 'name', 'fullName', 'reportingIndividual']));
  if (!name) return null;
  var cleanName = cleanPersonName(name);

  var transactionDate = toIsoDate(asString_(pickField_(flat,
    ['transactionDate', 'tradeDate', 'txDate', 'dateTransacted', 'transaction_date', 'date'])));
  var disclosureDate = toIsoDate(asString_(pickField_(flat,
    ['disclosureDate', 'filingDate', 'reportDate', 'dateReceived', 'filedDate',
     'disclosure_date', 'reportedDate', 'notificationDate']))) || transactionDate;

  if (!transactionDate || !disclosureDate) return null;

  var ticker = normalizeTicker(asString_(pickField_(flat,
    ['ticker', 'symbol', 'assetTicker', 'securityTicker', 'tickerSymbol'])));

  var assetName = asString_(pickField_(flat, ['assetDescription', 'assetName', 'asset',
    'security', 'securityName', 'issuer', 'company', 'companyName', 'description'])) || ticker;
  if (!assetName) return null;

  // Amount arrives as a range string, explicit bounds, or a single figure we
  // snap onto the nearest disclosure bracket.
  var rangeText = asString_(pickField_(flat, ['amount', 'amountRange', 'range', 'value', 'transactionAmount']));
  var explicitMin = asNumber_(pickField_(flat, ['amountFrom', 'amountMin', 'minAmount', 'low', 'rangeLow']));
  var explicitMax = asNumber_(pickField_(flat, ['amountTo', 'amountMax', 'maxAmount', 'high', 'rangeHigh']));

  var bracket;
  if (explicitMin !== undefined && explicitMax !== undefined && explicitMax >= explicitMin) {
    bracket = parseAmountRange('$' + explicitMin + ' - $' + explicitMax);
  } else {
    bracket = parseAmountRange(rangeText);
  }
  if (bracket.min === 0 && bracket.max === 0) return null;

  var type = normalizeTradeType(asString_(pickField_(flat,
    ['type', 'transactionType', 'tradeType', 'action', 'txType', 'orderType'])));

  var chamber = normalizeChamber(asString_(pickField_(flat,
    ['chamber', 'house', 'body', 'filerType', 'office'])) || defaultChamber || 'house');

  var stateRaw = (asString_(pickField_(flat, ['state', 'stateCode', 'senatorState'])) || 'US')
    .toUpperCase().slice(0, 2);
  var state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : 'US';

  var assetTypeHint = asString_(pickField_(flat, ['assetType', 'securityType', 'assetClass'])) || '';
  var id = politicianId(cleanName, chamber);
  var capGains = asString_(pickField_(flat, ['capitalGainsOver200', 'capGainsOver200', 'capitalGains']));

  return {
    id: source + '-' + tradeKey({
      politicianId: id, ticker: ticker, assetName: assetName,
      transactionDate: transactionDate, type: type, amountMin: bracket.min
    }),
    politicianId: id,
    politicianName: cleanName,
    chamber: chamber,
    party: normalizeParty(asString_(pickField_(flat, ['party', 'partyName', 'politicalParty']))),
    state: state,
    ticker: ticker,
    assetName: assetName,
    assetClass: inferAssetClass(assetName + ' ' + assetTypeHint, ticker),
    type: type,
    owner: normalizeOwner(asString_(pickField_(flat, ['owner', 'ownerType', 'ownedBy']))),
    transactionDate: transactionDate,
    disclosureDate: disclosureDate,
    filingDelayDays: daysBetween(transactionDate, disclosureDate),
    amountMin: bracket.min,
    amountMax: bracket.max,
    amountMid: bracketMidpoint(bracket.min, bracket.max),
    amountRange: bracket.label,
    source: source,
    filingUrl: asString_(pickField_(flat, ['link', 'url', 'filingUrl', 'ptrLink', 'documentUrl'])),
    capitalGainsOver200: capGains === null ? null : /true|yes|1/i.test(capGains),
    comment: asString_(pickField_(flat, ['comment', 'comments', 'notes']))
  };
}

/**
 * Find the array of records inside an unknown JSON payload. Aggregators return
 * a bare array, or { data: [...] }, { results: [...] }, and so on.
 */
function extractRows_(payload) {
  if (Object.prototype.toString.call(payload) === '[object Array]') return payload;
  if (payload && typeof payload === 'object') {
    var keys = ['data', 'results', 'trades', 'transactions', 'items', 'records', 'rows'];
    for (var i = 0; i < keys.length; i++) {
      var v = payload[keys[i]];
      if (Object.prototype.toString.call(v) === '[object Array]') return v;
    }
  }
  return [];
}

function mapLooseTrades(payload, source, defaultChamber) {
  var rows = extractRows_(payload);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var t = mapLooseTrade(rows[i], source, defaultChamber);
    if (t) out.push(t);
  }
  return out;
}

/** Quiver Quantitative — bulk congressional trading feed. */
function fetchQuiverTrades_(key) {
  var url = getProp_('QUIVER_CONGRESS_URL', 'https://api.quiverquant.com/beta/bulk/congresstrading');
  var payload = httpJson_(url, { headers: { Authorization: 'Bearer ' + key } });
  return { trades: mapLooseTrades(payload, 'quiver', 'house'), filings: [], roster: {} };
}

/** Unusual Whales — recent congress trades. */
function fetchUnusualWhalesTrades_(key) {
  var url = getProp_('UNUSUAL_WHALES_CONGRESS_URL',
    'https://api.unusualwhales.com/api/congress/recent-trades?limit=500');
  var payload = httpJson_(url, { headers: { Authorization: 'Bearer ' + key } });
  return { trades: mapLooseTrades(payload, 'unusual-whales', 'house'), filings: [], roster: {} };
}

/** Financial Modeling Prep — separate Senate and House feeds, both paged. */
function fetchFmpTrades_(key) {
  var bases = [
    getProp_('FMP_SENATE_URL', 'https://financialmodelingprep.com/api/v4/senate-trading-rss-feed'),
    getProp_('FMP_HOUSE_URL', 'https://financialmodelingprep.com/api/v4/senate-disclosure-rss-feed')
  ];

  var trades = [];
  var failures = 0, attempts = 0;
  for (var b = 0; b < bases.length; b++) {
    for (var page = 0; page < 3; page++) {
      attempts++;
      var sep = bases[b].indexOf('?') >= 0 ? '&' : '?';
      var url = bases[b] + sep + 'page=' + page + '&apikey=' + encodeURIComponent(key);
      try {
        trades = trades.concat(mapLooseTrades(httpJson_(url), 'fmp', 'senate'));
      } catch (err) {
        failures++;
      }
    }
  }
  if (failures === attempts) throw new Error('all FMP requests failed');
  return { trades: trades, filings: [], roster: {} };
}

/**
 * Finnhub's congressional endpoint is SYMBOL-SCOPED, so it cannot produce a
 * global feed on its own — it enriches specific tickers. We iterate whichever
 * tickers the other sources already surfaced, which keeps the request count
 * bounded and the data relevant.
 */
function fetchFinnhubTrades_(key, symbols) {
  if (!symbols || !symbols.length) return { trades: [], filings: [], roster: {} };
  var base = getProp_('FINNHUB_CONGRESS_URL', 'https://finnhub.io/api/v1/stock/congressional-trading');

  var rows = [];
  var limit = Math.min(symbols.length, 25);   // keep well inside UrlFetchApp quota
  for (var i = 0; i < limit; i++) {
    var url = base + '?symbol=' + encodeURIComponent(symbols[i]) + '&token=' + encodeURIComponent(key);
    try {
      var payload = httpJson_(url);
      var data = (payload && payload.data) || [];
      for (var j = 0; j < data.length; j++) {
        // Finnhub omits the symbol on each row, so stamp it back on.
        var row = data[j];
        row.symbol = symbols[i];
        rows.push(row);
      }
    } catch (err) {
      // Skip this symbol; one bad ticker shouldn't fail the source.
    }
  }
  return { trades: mapLooseTrades(rows, 'finnhub', 'house'), filings: [], roster: {} };
}
