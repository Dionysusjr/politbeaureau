/**
 * Disclosure amount brackets.
 *
 * Filers never report an exact figure for a transaction — they check a box for
 * a range. These are the ranges used on House and Senate PTRs under the STOCK
 * Act and the Ethics in Government Act. Everything downstream ranks on the
 * bracket midpoint, which is an estimate and is labelled as such in the UI.
 *
 * Apps Script has no modules: every .gs file shares one global namespace, so
 * names here are prefixed or distinctive enough not to collide.
 */

var AMOUNT_BRACKETS = [
  { min: 1,          max: 1000,      label: '$1 - $1,000' },
  { min: 1001,       max: 15000,     label: '$1,001 - $15,000' },
  { min: 15001,      max: 50000,     label: '$15,001 - $50,000' },
  { min: 50001,      max: 100000,    label: '$50,001 - $100,000' },
  { min: 100001,     max: 250000,    label: '$100,001 - $250,000' },
  { min: 250001,     max: 500000,    label: '$250,001 - $500,000' },
  { min: 500001,     max: 1000000,   label: '$500,001 - $1,000,000' },
  { min: 1000001,    max: 5000000,   label: '$1,000,001 - $5,000,000' },
  { min: 5000001,    max: 25000000,  label: '$5,000,001 - $25,000,000' },
  { min: 25000001,   max: 50000000,  label: '$25,000,001 - $50,000,000' },
  // The top bracket is open-ended on the form. We cap it so midpoints stay
  // finite; the label keeps the "Over" so nobody reads the cap as a reported
  // ceiling.
  { min: 50000001,   max: 100000000, label: 'Over $50,000,000' }
];

/**
 * Midpoint of a bracket. For the open-ended top bracket we use the floor rather
 * than a midpoint of an invented ceiling, so nobody's total is inflated by a
 * number that was never disclosed.
 */
function bracketMidpoint(min, max) {
  var top = AMOUNT_BRACKETS[AMOUNT_BRACKETS.length - 1];
  if (min >= top.min) return min;
  if (!isFinite(max) || max <= 0) return min;
  return Math.round((min + max) / 2);
}

/** Find the bracket a raw dollar figure falls into. */
function bracketFor(value) {
  for (var i = 0; i < AMOUNT_BRACKETS.length; i++) {
    var b = AMOUNT_BRACKETS[i];
    if (value >= b.min && value <= b.max) return b;
  }
  return AMOUNT_BRACKETS[AMOUNT_BRACKETS.length - 1];
}

function amountToNumber_(raw) {
  var n = Number(String(raw).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : 0;
}

/**
 * Parse an amount range as it appears in filings and aggregator payloads.
 * Handles "$1,001 - $15,000", en/em dashes, "Over $50,000,000", "$1,000,001 +",
 * and bare single values.
 */
function parseAmountRange(raw) {
  if (!raw) return { min: 0, max: 0, label: 'Undisclosed' };
  var text = String(raw).replace(/[–—]/g, '-').trim();

  var pair = text.match(/\$?\s*([\d,.]+)\s*-\s*\$?\s*([\d,.]+)/);
  if (pair) {
    var pmin = amountToNumber_(pair[1]);
    var pmax = amountToNumber_(pair[2]);
    return { min: pmin, max: pmax, label: canonicalAmountLabel(pmin, pmax) };
  }

  // Open-ended forms are bracket *labels*, so snap them onto the canonical
  // bracket starting at the stated floor. "Over $X" excludes X itself — the top
  // box reads "Over $50,000,000" and its floor is $50,000,001 — whereas "$X +"
  // includes X. Treating them alike yields a floor one dollar low and a
  // degenerate "$50M - $50M" range matching no real bracket.
  var over = text.match(/(?:over|above|more than|greater than)\s*\$?\s*([\d,.]+)/i);
  var plus = text.match(/\$?\s*([\d,.]+)\s*\+/);
  if (over || plus) {
    var floor = over ? amountToNumber_(over[1]) + 1 : amountToNumber_(plus[1]);
    var bracket = null;
    for (var i = 0; i < AMOUNT_BRACKETS.length; i++) {
      if (AMOUNT_BRACKETS[i].min === floor) { bracket = AMOUNT_BRACKETS[i]; break; }
    }
    if (!bracket) bracket = bracketFor(floor);
    return { min: bracket.min, max: bracket.max, label: bracket.label };
  }

  var single = text.match(/\$?\s*([\d,.]+)/);
  if (single) {
    var snapped = bracketFor(amountToNumber_(single[1]));
    return { min: snapped.min, max: snapped.max, label: snapped.label };
  }

  return { min: 0, max: 0, label: 'Undisclosed' };
}

/** Snap arbitrary min/max bounds onto the canonical bracket label. */
function canonicalAmountLabel(min, max) {
  for (var i = 0; i < AMOUNT_BRACKETS.length; i++) {
    var b = AMOUNT_BRACKETS[i];
    if (b.min === min && b.max === max) return b.label;
  }
  var top = AMOUNT_BRACKETS[AMOUNT_BRACKETS.length - 1];
  if (min >= top.min) return top.label;
  return formatUsdCompact(min) + ' - ' + formatUsdCompact(max);
}

function formatUsdCompact(value) {
  var abs = Math.abs(value);
  var sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'K';
  return sign + '$' + abs.toFixed(0);
}
