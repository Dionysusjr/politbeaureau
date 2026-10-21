/**
 * House Clerk financial disclosures — official primary source, free, no key.
 *
 *   https://disclosures-clerk.house.gov/public_disc/financial-pdfs/<YEAR>FD.zip
 *
 * The ZIP contains a machine-readable index (<YEAR>FD.xml) and the filing PDFs.
 * The index gives filer, filing type, state/district, filing date and a doc id.
 *
 * IMPORTANT LIMITATION: the index is FILING-LEVEL ONLY. Transaction rows —
 * ticker, amount bracket, buy/sell — exist only inside each PTR *PDF*, many of
 * which are scans needing OCR. So this provider yields filings and roster
 * metadata, never trades. Ticker-level House data needs an aggregator (which
 * does the PDF extraction) or your own OCR pipeline.
 *
 * On Apps Script: Utilities.unzip() replaces fflate, XmlService replaces cheerio.
 */

function houseZipUrl_(year) {
  return 'https://disclosures-clerk.house.gov/public_disc/financial-pdfs/' + year + 'FD.zip';
}

var HOUSE_FILING_TYPE_ = {
  P: 'Periodic Transaction Report',
  O: 'Annual Report',
  A: 'Amendment',
  C: 'Candidate Report',
  T: 'Termination Report',
  X: 'Extension Request',
  D: 'Blind Trust / Other',
  W: 'Withdrawal'
};

/** "CA11" -> { state: "CA", district: 11 }; "CA00" means at-large/undesignated. */
function parseStateDistrict_(raw) {
  var text = String(raw || '').trim().toUpperCase();
  var m = text.match(/^([A-Z]{2})(\d{0,2})$/);
  if (!m) return { state: text.slice(0, 2) || 'US', district: null };
  var district = m[2] ? Number(m[2]) : 0;
  return { state: m[1], district: district > 0 ? district : null };
}

/**
 * PTRs and annual reports live under different paths on the Clerk's site.
 * Codes other than "P" are annual-style filings served from financial-pdfs.
 */
function houseDocumentUrl_(year, docId, code) {
  if (!docId) return null;
  var dir = code === 'P' ? 'ptr-pdfs' : 'financial-pdfs';
  return 'https://disclosures-clerk.house.gov/public_disc/' + dir + '/' + year + '/' + docId + '.pdf';
}

/**
 * Pull the XML index out of a downloaded archive without inflating the rest.
 *
 * Utilities.unzip() decompresses every entry it is given, so if this URL ever
 * also carried the filing PDFs, reading one small XML would cost memory
 * proportional to all of them — in Apps Script that is an opaque
 * "exceeded memory limit" failure. The size guard turns that into a
 * diagnosable error, and we pick out the XML blob without touching the others.
 *
 * Separated from the fetch so it can be tested against a synthetic archive.
 */
function extractHouseIndexXml_(blob, label) {
  var bytes = blob.getBytes().length;
  if (bytes > CONFIG.MAX_ZIP_BYTES) {
    throw new Error(
      label + ' is ' + Math.round(bytes / 1048576) + 'MB, over the ' +
      Math.round(CONFIG.MAX_ZIP_BYTES / 1048576) + 'MB cap — refusing to decompress it. ' +
      'The Clerk may have changed what this URL publishes.');
  }

  var entries = Utilities.unzip(blob);
  for (var i = 0; i < entries.length; i++) {
    var name = entries[i].getName() || '';
    if (name.toLowerCase().slice(-4) === '.xml') {
      return entries[i].getDataAsString();
    }
  }
  throw new Error(label + ' contained no XML index');
}

/**
 * Parse the <YEAR>FD.xml index with XmlService. Exported-by-convention so it can
 * be exercised against a fixture without network access.
 */
function parseHouseIndexXml(xml, year) {
  var doc = XmlService.parse(xml);
  var root = doc.getRootElement();
  var members = root.getChildren('Member');

  var filings = [];
  var rosterById = {};

  for (var i = 0; i < members.length; i++) {
    var node = members[i];
    var text = function (tag) {
      var child = node.getChild(tag);
      return child ? String(child.getText()).trim() : '';
    };

    var last = text('Last');
    var firstName = text('First');
    if (!last && !firstName) continue;

    var suffix = text('Suffix');
    var rawName = [firstName, last, suffix].filter(function (p) { return !!p; }).join(' ');
    var name = cleanPersonName(rawName);
    var id = politicianId(name, 'house');

    var code = (text('FilingType') || '').toUpperCase();
    var docId = text('DocID');
    var filedDate = toIsoDate(text('FilingDate')) || (year + '-01-01');
    var sd = parseStateDistrict_(text('StateDst'));
    var filingYear = Number(text('Year')) || year;

    filings.push({
      id: 'house-' + (docId || (id + '-' + filedDate)),
      politicianId: id,
      politicianName: name,
      chamber: 'house',
      state: sd.state,
      district: sd.district,
      filingType: HOUSE_FILING_TYPE_[code] || (code ? 'Filing type ' + code : 'Filing'),
      filingTypeCode: code || null,
      filedDate: filedDate,
      year: filingYear,
      documentUrl: houseDocumentUrl_(filingYear, docId, code),
      source: 'house-clerk',
      // Every House filing's transaction detail is PDF-only.
      detailInPdfOnly: true
    });

    if (!rosterById[id]) {
      rosterById[id] = {
        id: id, name: name, chamber: 'house',
        party: 'unknown',   // the Clerk's index does not carry party
        state: sd.state, district: sd.district,
        role: 'Representative', committees: []
      };
    }
  }

  filings.sort(function (a, b) { return b.filedDate.localeCompare(a.filedDate); });
  return { filings: filings, roster: rosterById };
}

/** Download and parse one year's House disclosure index. */
function fetchHouseIndex_(year) {
  var url = houseZipUrl_(year);
  var res = httpFetch_(url, { headers: { Accept: 'application/zip' } });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('House Clerk returned HTTP ' + code + ' for ' + year + 'FD.zip');
  }
  var xml = extractHouseIndexXml_(res.getBlob(), year + 'FD.zip');
  return parseHouseIndexXml(xml, year);
}

/**
 * Fetch the current year and, early in the year, the previous one too, so the
 * feed isn't nearly empty every January.
 */
function fetchHouseFilings_() {
  var now = new Date();
  var year = now.getUTCFullYear();
  var years = now.getUTCMonth() < 3 ? [year, year - 1] : [year];

  var filings = [];
  var roster = {};
  var errors = [];

  for (var i = 0; i < years.length; i++) {
    try {
      var result = fetchHouseIndex_(years[i]);
      filings = filings.concat(result.filings);
      for (var id in result.roster) {
        if (result.roster.hasOwnProperty(id) && !roster[id]) roster[id] = result.roster[id];
      }
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (!filings.length && errors.length) throw new Error(errors[0]);

  filings.sort(function (a, b) { return b.filedDate.localeCompare(a.filedDate); });
  return { filings: filings, roster: roster, trades: [] };
}
