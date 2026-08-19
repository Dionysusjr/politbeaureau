/**
 * Visualisation tokens for the congress dashboard.
 *
 * This app renders on a single dark surface (`#0b1220`), so these are the dark
 * steps and there is no light variant to swap. Every colour here was validated
 * against that surface: all clear 3:1 for marks, and the text steps clear 4.5:1.
 *
 * Colour is assigned by the *job* it does, never by rank:
 *   - tier colours (gold/green/blue/red) live in tiers.ts and are always paired
 *     with the tier name as text, so hue never carries the tier alone;
 *   - buy/sell is a two-pole polarity, so it uses the status good/critical pair
 *     with a direction word beside it, not colour alone;
 *   - the price line is a single series, so it needs no legend.
 */

export const VIZ = {
  surface: "#0b1220",
  /** Slightly raised panel surface. */
  surfaceRaised: "#111a2b",
  textPrimary: "#f3f4f6",
  textSecondary: "#aab2c0",
  textMuted: "#7c8798",
  gridline: "#1e293b",
  axis: "#2c3a4f",
  border: "rgba(255,255,255,0.10)",

  /** Polarity pair for purchases vs sales. */
  buyMark: "#0ca30c",
  buyText: "#4ade80",
  sellMark: "#d03b3b",
  sellText: "#fca5a5",

  /** Single-series line colour (categorical slot 1, dark step). */
  series1: "#3987e5",
  series2: "#d95926",
} as const;

/** Party marks. Party is always shown as its letter too, never colour alone. */
export const PARTY_STYLE: Record<string, { mark: string; text: string; label: string }> = {
  D: { mark: "#3987e5", text: "#8fc0f7", label: "Democrat" },
  R: { mark: "#e12323", text: "#ff8a8a", label: "Republican" },
  I: { mark: "#af913c", text: "#e0c063", label: "Independent" },
  unknown: { mark: "#7c8798", text: "#aab2c0", label: "Not disclosed" },
};

export function partyStyle(party: string) {
  return PARTY_STYLE[party] ?? PARTY_STYLE.unknown!;
}
