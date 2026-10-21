/**
 * Configuration, read from Script Properties.
 *
 * Apps Script has no .env — settings live in Script Properties
 * (Project Settings → Script properties, or run `setupProperties()` once).
 * Never hard-code an API key in a .gs file: the project is shared with anyone
 * you give edit access, and the code is visible to them.
 */

function props_() {
  return PropertiesService.getScriptProperties();
}

function getProp_(key, fallback) {
  var v = props_().getProperty(key);
  return (v === null || v === '') ? (fallback === undefined ? null : fallback) : v;
}

/**
 * Identifies this deployment to upstream sources. The SEC's fair-access policy
 * REQUIRES a contact address in the User-Agent; the House and Senate sites
 * behave better with one too.
 */
function userAgent_() {
  var contact = getProp_('CONTACT_EMAIL');
  return contact
    ? 'capitol-ledger-apps-script/1.0 (' + contact + ')'
    : 'capitol-ledger-apps-script/1.0 (set CONTACT_EMAIL in Script properties)';
}

function isEnabled_(key) {
  // Free primary sources default ON; anything else needs an explicit value.
  return getProp_(key, 'true') !== 'false';
}

/**
 * This port is LIVE ONLY — there is no simulator and no synthetic data, so a
 * published page can never show invented filers or placeholder prices. When no
 * source returns anything the UI says so plainly, with per-source diagnostics.
 */
var CONFIG = {
  // How often the browser asks the server for a fresh snapshot.
  POLL_MS: 30000,
  // How many Senate report pages to open per refresh. Each is a separate
  // request and eFD is slow; the 6-minute script limit is the real ceiling.
  SENATE_MAX_REPORTS: 20,
  SENATE_SINCE_DAYS: 90,
  // Refuse to buffer an archive larger than this. The House index ZIP is a few
  // MB; at this scale the Clerk has changed what they publish at that URL, and
  // inflating it would blow the script's memory as an opaque crash.
  MAX_ZIP_BYTES: 48 * 1024 * 1024,
  // Trades kept in the snapshot payload. CacheService caps a value at 100KB,
  // and we chunk, but there is no point shipping an unbounded list to a browser.
  MAX_TRADES: 1200
};

/**
 * Run once from the editor to record your settings. Edit the values first.
 * You can also set these by hand in Project Settings → Script properties.
 */
function setupProperties() {
  props_().setProperties({
    CONTACT_EMAIL: 'you@example.com',   // required before enabling live sources
    ENABLE_HOUSE_CLERK: 'true',
    ENABLE_SENATE_EFD: 'true',
    PRICE_DATA_SOURCE: 'stooq',         // stooq | none
    // Aggregator keys — each enables that source by being present. These are
    // the practical route to ticker-level House data.
    FMP_API_KEY: '',
    QUIVER_API_KEY: '',
    UNUSUAL_WHALES_API_KEY: '',
    FINNHUB_API_KEY: ''
  }, false);
  Logger.log('Script properties written. Now run setupTrigger().');
}
