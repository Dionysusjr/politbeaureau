/**
 * Portfolio-size tiers: mega = gold, large = green, medium = blue, small = red.
 *
 * Thresholds are on the *estimated* portfolio value (sum of disclosure bracket
 * midpoints), so they are deliberately coarse — brackets can't support more
 * precision. Edit TIER_FLOOR to re-cut the bands.
 */

var TIER_FLOOR = { mega: 5000000, large: 1000000, medium: 250000, small: 0 };

var TIER_ORDER = ['mega', 'large', 'medium', 'small'];

function classifyTier(portfolioValue) {
  if (portfolioValue >= TIER_FLOOR.mega) return 'mega';
  if (portfolioValue >= TIER_FLOOR.large) return 'large';
  if (portfolioValue >= TIER_FLOOR.medium) return 'medium';
  return 'small';
}

/**
 * Tier palette. The `mark` values are validated hexes: they cleared the dark
 * lightness band, the chroma floor, the all-pairs normal-vision separation floor
 * (worst ΔE 20.0) and 3:1 contrast against this app's #0b1220 surface.
 *
 * Their worst all-pairs colour-vision-deficiency separation sits in the 6-8
 * floor band (gold vs red, deutan ΔE 7.3), which is only legal alongside
 * secondary encoding — so EVERY tier badge renders the tier name as text, and
 * colour never carries the tier alone. Keep that property if you re-theme.
 *
 * The `text` values are lighter steps of the same hues (all >= 8:1), because the
 * mark steps are tuned for fills, not for small text.
 */
var TIER_STYLE = {
  mega:   { mark: '#af913c', text: '#e0c063', label: 'MEGA',   shortLabel: 'MEGA',  description: '$5M+ estimated portfolio' },
  large:  { mark: '#008300', text: '#4ac97a', label: 'LARGE',  shortLabel: 'LARGE', description: '$1M - $5M estimated portfolio' },
  medium: { mark: '#3987e5', text: '#8fc0f7', label: 'MEDIUM', shortLabel: 'MED',   description: '$250K - $1M estimated portfolio' },
  small:  { mark: '#e12323', text: '#ff8a8a', label: 'SMALL',  shortLabel: 'SMALL', description: 'Under $250K estimated portfolio' }
};

/** Party marks. Party is always shown as its letter too, never colour alone. */
var PARTY_STYLE = {
  D:       { mark: '#3987e5', text: '#8fc0f7', label: 'Democrat' },
  R:       { mark: '#e12323', text: '#ff8a8a', label: 'Republican' },
  I:       { mark: '#af913c', text: '#e0c063', label: 'Independent' },
  unknown: { mark: '#7c8798', text: '#aab2c0', label: 'Not disclosed' }
};
