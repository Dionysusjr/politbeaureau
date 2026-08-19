"use client";

import Link from "next/link";
import { PoliticianSummary } from "@/lib/types";
import { TIER_STYLE } from "@/lib/tiers";
import { formatUsdCompact } from "@/lib/amounts";
import { VIZ, partyStyle } from "@/lib/viz-tokens";
import TierBadge from "./TierBadge";

/**
 * Ranked leaderboard by estimated portfolio size.
 *
 * The bar is a magnitude encoding on a shared scale (widest portfolio = full
 * width), with 4px rounded ends anchored to a common left baseline. Bar colour
 * follows the filer's **tier**, which is an attribute of the entity, and the
 * tier name rides alongside as text — so filtering the list never repaints a
 * survivor and colour never carries the tier alone.
 */
export default function PoliticianLeaderboard({
  politicians,
  max = 25,
}: {
  politicians: PoliticianSummary[];
  max?: number;
}) {
  const rows = politicians.slice(0, max);
  const scaleMax = Math.max(...rows.map((p) => p.portfolioValue), 1);

  if (rows.length === 0) {
    return (
      <p className="px-1 py-6 text-sm" style={{ color: VIZ.textMuted }}>
        No filers in this view.
      </p>
    );
  }

  return (
    <ol className="space-y-1">
      {rows.map((p) => {
        const style = TIER_STYLE[p.tier];
        const widthPct = Math.max(1.5, (p.portfolioValue / scaleMax) * 100);
        const party = partyStyle(p.party);

        return (
          <li key={p.id}>
            <Link
              href={`/politician/${p.id}`}
              className="group block rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-7 shrink-0 text-right text-xs tabular-nums"
                  style={{ color: VIZ.textMuted }}
                >
                  {p.rank}
                </span>

                <span
                  className="min-w-0 flex-1 truncate text-sm font-medium group-hover:underline"
                  style={{ color: VIZ.textPrimary }}
                >
                  {p.name}
                </span>

                <span className="hidden shrink-0 items-center gap-1 text-xs sm:inline-flex">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: party.mark }} />
                  <span style={{ color: party.text }}>{p.party === "unknown" ? "—" : p.party}</span>
                  <span style={{ color: VIZ.textMuted }}>
                    {p.state}
                    {p.district ? `-${p.district}` : ""}
                  </span>
                </span>

                <TierBadge tier={p.tier} size="sm" />

                <span
                  className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums"
                  style={{ color: VIZ.textPrimary }}
                  title={`Estimated ${formatUsdCompact(p.portfolioValueMin)} – ${formatUsdCompact(p.portfolioValueMax)}`}
                >
                  {formatUsdCompact(p.portfolioValue)}
                </span>

                <span
                  className="hidden w-14 shrink-0 text-right text-xs tabular-nums md:inline"
                  style={{ color: VIZ.textMuted }}
                >
                  {p.tradeCount} trd
                </span>
              </div>

              {/* Magnitude bar: 4px rounded end, anchored to a shared baseline. */}
              <div className="mt-1.5 ml-10 h-1.5 overflow-hidden rounded-sm" style={{ backgroundColor: VIZ.gridline }}>
                <div
                  className="h-full rounded-r"
                  style={{ width: `${widthPct}%`, backgroundColor: style.mark }}
                />
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
