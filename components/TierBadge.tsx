import { PortfolioTier } from "@/lib/types";
import { TIER_STYLE, TIER_ORDER } from "@/lib/tiers";

/**
 * Tier badge. The tier **name is always rendered as text** next to the colour —
 * that is a hard requirement, not decoration: the gold/red pair sits in the
 * 6-8 CVD floor band, which is only legal with secondary encoding.
 */
export default function TierBadge({
  tier,
  size = "md",
}: {
  tier: PortfolioTier;
  size?: "sm" | "md";
}) {
  const style = TIER_STYLE[tier];
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold tracking-wide ${pad}`}
      style={{
        color: style.text,
        borderColor: `${style.mark}80`,
        backgroundColor: `${style.mark}1f`,
      }}
      title={style.description}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: style.mark }}
      />
      {size === "sm" ? style.shortLabel : style.label}
    </span>
  );
}

/** Legend for the tier scale, with the dollar band each tier represents. */
export function TierLegend({ counts }: { counts?: Record<PortfolioTier, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {TIER_ORDER.map((tier) => {
        const style = TIER_STYLE[tier];
        return (
          <span key={tier} className="inline-flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: style.mark }}
            />
            <span className="font-semibold" style={{ color: style.text }}>
              {style.label}
            </span>
            <span className="text-gray-400">{style.description}</span>
            {counts && (
              <span className="tabular-nums text-gray-500">({counts[tier]})</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
