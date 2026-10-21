/**
 * Senate Electronic Financial Disclosure (eFD) — official, free, no API key.
 * https://efd.senate.gov
 *
 * There is no documented API. The search screen is a DataTables widget backed by
 * a JSON endpoint, reachable only after a three-step handshake:
 *
 *   1. GET  /search/home/        — obtain the CSRF cookie + form token
 *   2. POST /search/home/        — accept the prohibition agreement
 *   3. POST /search/report/data/ — DataTables JSON query
 *
 * Unlike the House index, Senate *electronic* PTRs render transaction rows as an
 * HTML table, so real ticker-level trades can be parsed. Paper filings are
 * scanned images (/search/view/paper/...) and yield a filing with no rows.
 *
 * Because this rides on an undocumented internal endpoint it is best-effort:
 * parameter names and markup can change without notice, and the caller reports
 * the failure rather than taking the dashboard down.
 *
 * On Apps Script, UrlFetchApp does not keep cookies, so the handshake carries
 * them by hand via CookieJar_.
 */

var EFD_BASE_ = 'https://efd.senate.gov';
var EFD_HOME_ = EFD_BASE_ + '/search/home/';
var EFD_DATA_ = EFD_BASE_ + '/search/report/data/';

/** Report type 11 = Periodic Transaction Report in eFD's taxonomy. */
var EFD_REPORT_TYPE_PTR_ = '11';

/** Steps 1 and 2: get a CSRF token and accept the prohibition agreement. */
function efdOpenSession_() {
  var jar = new CookieJar_();

  var homeRes = httpFetch_(EFD_HOME_, { headers: { Accept: 'text/html' } });
  if (homeRes.getResponseCode() !== 200) {
    throw new Error('eFD home returned HTTP ' + homeRes.getResponseCode());
  }
  jar.absorb(homeRes);

  var html = homeRes.getContentText();
  var tokenMatch = html.match(/name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i) ||
                   html.match(/value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/i);
  var token = tokenMatch ? tokenMatch[1] : jar.get('csrftoken');
  if (!token) throw new Error('eFD did not return a CSRF token');

  var agreeRes = httpFetch_(EFD_HOME_, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: formEncode_({ csrfmiddlewaretoken: token, prohibition_agreement: '1' }),
    followRedirects: false,
    headers: { Cookie: jar.header(), Referer: EFD_HOME_, Origin: EFD_BASE_ }
  });
  jar.absorb(agreeRes);

  // A 200 or a redirect both mean the agreement was accepted.
  if (agreeRes.getResponseCode() >= 400) {
    throw new Error('eFD agreement POST returned HTTP ' + agreeRes.getResponseCode());
  }

  return { jar: jar, token: jar.get('csrftoken') || token };
}

function efdFormatDate_(d) {
  return padTwo_(d.getMonth() + 1) + '/' + padTwo_(d.getDate()) + '/' + d.getFullYear();
}

/** Step 3: query the DataTables endpoint for recent PTRs. */
function efdSearchReports_(session, sinceDays, length) {
  var end = new Date();
  var start = new Date(end.getTime() - sinceDays * 86400000);

  var payload = {
    draw: '1',
    'columns[0][data]': '0', 'columns[1][data]': '1', 'columns[2][data]': '2',
    'columns[3][data]': '3', 'columns[4][data]': '4',
    'order[0][column]': '4', 'order[0][dir]': 'desc',
    start: '0', length: String(length),
    'search[value]': '', 'search[regex]': 'false',
    first_name: '', last_name: '', filer_type: '',
    submitted_start_date: efdFormatDate_(start) + ' 00:00:00',
    submitted_end_date: efdFormatDate_(end) + ' 23:59:59',
    csrfmiddlewaretoken: session.token,
    'report_types[]': [EFD_REPORT_TYPE_PTR_],
    'filer_types[]': ['1'],
    senator_state: '', office_id: ''
  };

  var res = httpFetch_(EFD_DATA_, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: formEncode_(payload),
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': session.token,
      Cookie: session.jar.header(),
      Referer: EFD_HOME_,
      Origin: EFD_BASE_
    }
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('eFD search returned HTTP ' + res.getResponseCode());
  }

  var payloadJson = JSON.parse(res.getContentText());
  var data = payloadJson.data || [];
  var rows = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row || row.length < 5) continue;
    var linkHtml = String(row[3] || '');
    var href = firstHref_(linkHtml);
    rows.push({
      firstName: htmlToText_(String(row[0] || '')),
      lastName: htmlToText_(String(row[1] || '')),
      office: htmlToText_(String(row[2] || '')),
      reportTitle: htmlToText_(linkHtml) || 'Periodic Transaction Report',
      reportPath: href ? (href.indexOf('http') === 0 ? href : EFD_BASE_ + href) : null,
      filedDate: toIsoDate(htmlToText_(String(row[4] || ''))) || ''
    });
  }

  return rows;
}

/** eFD office strings look like "Warner, Mark R. (Senator)" or a state name. */
function efdStateFromOffice_(office) {
  var paren = String(office).match(/\(([^)]+)\)\s*$/);
  var source = paren ? paren[1] : String(office);
  var code = source.match(/\b([A-Z]{2})\b/);
  return code ? code[1] : 'US';
}

/**
 * Parse the transactions table out of an electronic PTR page.
 *
 * eFD's column order is: #, Transaction Date, Owner, Ticker, Asset Name,
 * Asset Type, Type, Amount, Comment. Columns are matched by header name rather
 * than fixed position, so an inserted column doesn't silently shift every field.
 */
function parseSenatePtrHtml(html, context) {
  var tables = extractTables_(html);
  var trades = [];

  for (var t = 0; t < tables.length; t++) {
    var headers = tables[t].headers;
    if (!headers.length) continue;

    var iDate = findColumn_(headers, ['transaction date', 'date']);
    var iAmount = findColumn_(headers, ['amount']);
    var iAssetType = findColumn_(headers, ['asset type', 'security type']);
    var iAsset = findColumn_(headers, ['asset name', 'asset', 'security'], [iAssetType]);
    if (iDate < 0 || iAmount < 0 || iAsset < 0) continue;  // not the transactions table

    var iOwner = findColumn_(headers, ['owner']);
    var iTicker = findColumn_(headers, ['ticker']);
    var iType = findColumn_(headers, ['type', 'transaction type', 'action'], [iAssetType]);
    var iComment = findColumn_(headers, ['comment']);

    var rows = tables[t].rows;
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r];
      if (cells.length < 3) continue;
      var at = function (i) { return i >= 0 && i < cells.length ? htmlToText_(cells[i]) : ''; };

      var transactionDate = toIsoDate(at(iDate));
      var assetName = at(iAsset);
      if (!transactionDate || !assetName) continue;

      var ticker = normalizeTicker(at(iTicker));
      var bracket = parseAmountRange(at(iAmount));
      var type = normalizeTradeType(at(iType));

      var base = {
        politicianId: context.politicianId, ticker: ticker, assetName: assetName,
        transactionDate: transactionDate, type: type, amountMin: bracket.min
      };

      trades.push({
        id: 'senate-' + tradeKey(base),
        politicianId: context.politicianId,
        politicianName: context.politicianName,
        chamber: 'senate',
        party: 'unknown',   // eFD does not publish party
        state: context.state,
        ticker: ticker,
        assetName: assetName,
        assetClass: inferAssetClass(assetName + ' ' + at(iAssetType), ticker),
        type: type,
        owner: normalizeOwner(at(iOwner)),
        transactionDate: transactionDate,
        disclosureDate: context.filedDate,
        filingDelayDays: daysBetween(transactionDate, context.filedDate),
        amountMin: bracket.min,
        amountMax: bracket.max,
        amountMid: bracketMidpoint(bracket.min, bracket.max),
        amountRange: bracket.label,
        source: 'senate-efd',
        filingUrl: context.filingUrl || null,
        comment: at(iComment) || null
      });
    }
  }

  return trades;
}

/**
 * Fetch recent Senate PTRs and their transaction rows.
 *
 * Each report is a separate request and eFD is slow, so maxReports is bounded —
 * the 6-minute Apps Script execution limit is the real ceiling, and the refresh
 * runs on a trigger rather than in a user's request.
 */
function fetchSenateTrades_() {
  var session = efdOpenSession_();
  var rows = efdSearchReports_(session, CONFIG.SENATE_SINCE_DAYS, 100);

  var filings = [];
  var roster = {};
  var enriched = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var name = cleanPersonName((row.firstName + ' ' + row.lastName).trim());
    if (!name) continue;
    var id = politicianId(name, 'senate');
    var state = efdStateFromOffice_(row.office);

    if (!roster[id]) {
      roster[id] = {
        id: id, name: name, chamber: 'senate', party: 'unknown',
        state: state, district: null, role: 'Senator', committees: []
      };
    }

    var isPaper = row.reportPath ? row.reportPath.indexOf('/paper/') >= 0 : false;
    filings.push({
      id: 'senate-' + (row.reportPath || (id + '-' + row.filedDate)),
      politicianId: id, politicianName: name, chamber: 'senate', state: state,
      district: null,
      filingType: row.reportTitle, filingTypeCode: null,
      filedDate: row.filedDate,
      year: Number(String(row.filedDate).slice(0, 4)) || new Date().getUTCFullYear(),
      documentUrl: row.reportPath, source: 'senate-efd',
      detailInPdfOnly: isPaper
    });

    if (row.reportPath && !isPaper) {
      enriched.push({ row: row, id: id, name: name, state: state });
    }
  }

  var trades = [];
  var limit = Math.min(enriched.length, CONFIG.SENATE_MAX_REPORTS);
  for (var j = 0; j < limit; j++) {
    var e = enriched[j];
    try {
      var res = httpFetch_(e.row.reportPath, {
        headers: { Accept: 'text/html', Cookie: session.jar.header(), Referer: EFD_HOME_ },
        retries: 1
      });
      if (res.getResponseCode() !== 200) continue;
      trades = trades.concat(parseSenatePtrHtml(res.getContentText(), {
        politicianId: e.id, politicianName: e.name, state: e.state,
        filedDate: e.row.filedDate, filingUrl: e.row.reportPath
      }));
    } catch (err) {
      // One unreadable report must not sink the whole refresh.
    }
  }

  filings.sort(function (a, b) { return b.filedDate.localeCompare(a.filedDate); });
  return { trades: trades, filings: filings, roster: roster };
}
