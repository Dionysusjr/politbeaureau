/**
 * Minimal HTML helpers.
 *
 * Apps Script has no cheerio, and XmlService.parse() rejects real-world HTML
 * (unclosed tags, bare attributes, entities it doesn't know), so table scraping
 * is done with scoped regular expressions instead.
 *
 * This is deliberately narrow: it extracts rows and cells from tables and does
 * nothing else. It is not a parser, and it would be the wrong tool for anything
 * requiring nesting or selectors.
 */

var HTML_ENTITIES_ = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—'
};

function decodeEntities_(text) {
  return String(text)
    .replace(/&[a-zA-Z#0-9]+;/g, function (m) {
      if (HTML_ENTITIES_[m] !== undefined) return HTML_ENTITIES_[m];
      var num = m.match(/^&#(\d+);$/);
      if (num) return String.fromCharCode(Number(num[1]));
      var hex = m.match(/^&#x([0-9a-fA-F]+);$/);
      if (hex) return String.fromCharCode(parseInt(hex[1], 16));
      return m;
    });
}

/** Strip tags and collapse whitespace to the visible text of a fragment. */
function htmlToText_(fragment) {
  return decodeEntities_(String(fragment).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** First href in a fragment, or null. */
function firstHref_(fragment) {
  var m = String(fragment).match(/<a[^>]*href\s*=\s*["']([^"']+)["']/i);
  return m ? decodeEntities_(m[1]) : null;
}

/**
 * Extract every <table> in a document as { headers: string[], rows: string[][] }.
 * Headers come from <th> cells wherever they appear; rows are <tr>s made of
 * <td>s, so a header row never masquerades as data.
 */
function extractTables_(html) {
  var tables = [];
  var tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  var tableMatch;

  while ((tableMatch = tableRe.exec(html)) !== null) {
    var body = tableMatch[1];
    var headers = [];
    var rows = [];

    var rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    var rowMatch;
    while ((rowMatch = rowRe.exec(body)) !== null) {
      var rowHtml = rowMatch[1];

      var ths = rowHtml.match(/<th\b[^>]*>[\s\S]*?<\/th>/gi);
      if (ths && ths.length) {
        for (var h = 0; h < ths.length; h++) {
          headers.push(htmlToText_(ths[h]).toLowerCase());
        }
        continue;
      }

      var tds = rowHtml.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
      if (tds && tds.length) {
        var cells = [];
        for (var c = 0; c < tds.length; c++) {
          // Keep the raw cell so callers can pull an href out if they need one.
          cells.push(tds[c]);
        }
        rows.push(cells);
      }
    }

    tables.push({ headers: headers, rows: rows });
  }

  return tables;
}

/**
 * Resolve a column index by header name, preferring an exact match over a
 * substring one and skipping columns already claimed.
 *
 * The exact-match pass is essential: "Type" and "Asset Type" both contain
 * "type", and a substring search hits "Asset Type" first — which reads the
 * security's class as the transaction direction and turns every sale into a
 * purchase.
 */
function findColumn_(headers, names, exclude) {
  exclude = exclude || [];
  var usable = function (i) { return i >= 0 && exclude.indexOf(i) < 0; };
  var i, n;

  for (n = 0; n < names.length; n++) {
    for (i = 0; i < headers.length; i++) {
      if (headers[i] === names[n] && usable(i)) return i;
    }
  }
  for (n = 0; n < names.length; n++) {
    for (i = 0; i < headers.length; i++) {
      if (headers[i].indexOf(names[n]) >= 0 && usable(i)) return i;
    }
  }
  return -1;
}
