import { PortfolioTier } from "./types";

/**
 * Portfolio-size tiers requested for the dashboard ranking:
 *   mega = gold, large = green, medium = blue, small = red.
 *
 * Thresholds are on the *estimated* portfolio value (sum of disclosure bracket
 * midpoints), so they are deliberately coarse — brackets can't support more
 * precision than this. Edit `TIER_FLOOR` to re-cut the bands.
 */
export const TIER_FLOOR: Record<PortfolioTier, number> = {
  mega: 5_000_000,
  large: 1_000_000,
  medium: 250_000,
  small: 0,
};

export const TIER_ORDER: PortfolioTier[] = ["mega", "large", "medium", "small"];

export function classifyTier(portfolioValue: number): PortfolioTier {
  if (portfolioValue >= TIER_FLOOR.mega) return "mega";
  if (portfolioValue >= TIER_FLOOR.large) return "large";
  if (portfolioValue >= TIER_FLOOR.medium) return "medium";
  return "small";
}

/**
 * Tier palette. `mark` values are the validated hexes — they cleared the
 * lightness band, chroma floor, all-pairs normal-vision floor (worst ΔE 20.0)
 * and 3:1 contrast against this app's `#0b1220` surface. Their worst all-pairs
 * CVD separation sits in the 6-8 floor band (gold vs red, deutan ΔE 7.3), which
 * is only legal alongside secondary encoding — so **every tier badge renders the
 * tier name as text**, and colour never carries the tier alone.
 *
 * `text` values are lighter steps of the same hues used for type (all >= 8:1),
 * because the mark steps are tuned for fills, not for small text.
 */
export interface TierStyle {
  /** Validated fill/stroke colour for dots, bars, rails. */
  mark: string;
  /** Lighter same-hue step for text. */
  text: string;
  label: string;
  /** Short label used in dense table cells. */
  shortLabel: string;
  description: string;
}

export const TIER_STYLE: Record<PortfolioTier, TierStyle> = {
  mega: {
    mark: "#af913c",
    text: "#e0c063",
    label: "MEGA",
    shortLabel: "MEGA",
    description: "$5M+ estimated portfolio",
  },
  large: {
    mark: "#008300",
    text: "#4ac97a",
    label: "LARGE",
    shortLabel: "LARGE",
    description: "$1M – $5M estimated portfolio",
  },
  medium: {
    mark: "#3987e5",
    text: "#8fc0f7",
    label: "MEDIUM",
    shortLabel: "MED",
    description: "$250K – $1M estimated portfolio",
  },
  small: {
    mark: "#e12323",
    text: "#ff8a8a",
    label: "SMALL",
    shortLabel: "SMALL",
    description: "Under $250K estimated portfolio",
  },
};

/** Tailwind-free inline styles, so the validated hexes stay the single source of truth. */
export function tierBadgeStyle(tier: PortfolioTier) {
  const s = TIER_STYLE[tier];
  return {
    color: s.text,
    borderColor: `${s.mark}80`,
    backgroundColor: `${s.mark}1f`,
  };
}
