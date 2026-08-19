"use client";

import Link from "next/link";
import { AssetSummary } from "@/lib/types";
import { formatUsdCompact } from "@/lib/amounts";
import { ASSET_CLASS_LABEL } from "@/lib/normalize";
import { VIZ, partyStyle } from "@/lib/viz-tokens";
import { assetHref } from "@/lib/links";

/**
 * Most-traded assets by disclosed purchase value.
 *
 * The magnitude bar shares one scale across rows and is anchored to a common
 * left baseline, so row-to-row comparison is valid. Party mix is shown as counts
 * with letters, not as a colour-only stack.
 */
export default function AssetTable({
  assets,
  max = 20,
}: {
  assets: AssetSummary[];
  max?: number;
}) {
  const rows = assets.slice(0, max);
  const scaleMax = Math.max(...rows.map((a) => a.buyValue), 1);

  if (rows.length === 0) {
    return (
      <p className="px-1 py-6 text-sm" style={{ color: VIZ.textMuted }}>
        No assets in this view.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-left text-sm">
        <thead className="text-xs" style={{ color: VIZ.textMuted }}>
          <tr className="border-b" style={{ borderColor: VIZ.border }}>
            <th className="px-2 py-2 font-medium">Asset</th>
            <th className="px-2 py-2 font-medium">Class</th>
            <th className="px-2 py-2 text-right font-medium">Disclosed buys</th>
            <th className="px-2 py-2 text-right font-medium">Net flow</th>
            <th className="px-2 py-2 text-right font-medium">Filers</th>
            <th className="px-2 py-2 font-medium">Party mix</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const widthPct = Math.max(1.5, (a.buyValue / scaleMax) * 100);
            const netPositive = a.netValue >= 0;

            return (
              <tr key={a.id} className="border-b last:border-0" style={{ borderColor: VIZ.border }}>
                <td className="max-w-[16rem] px-2 py-2">
                  <Link href={assetHref(a)} className="font-medium hover:underline" style={{ color: VIZ.textPrimary }}>
                    {a.ticker ?? a.name.slice(0, 34)}
                  </Link>
                  {a.ticker && (
                    <div className="truncate text-xs" style={{ color: VIZ.textMuted }} title={a.name}>
                      {a.name}
                    </div>
                  )}
                  {/* Magnitude bar on a shared scale */}
                  <div className="mt-1 h-1 overflow-hidden rounded-sm" style={{ backgroundColor: VIZ.gridline }}>
                    <div className="h-full rounded-r" style={{ width: `${widthPct}%`, backgroundColor: VIZ.series1 }} />
                  </div>
                </td>

                <td className="whitespace-nowrap px-2 py-2 text-xs" style={{ color: VIZ.textSecondary }}>
                  {ASSET_CLASS_LABEL[a.assetClass]}
                </td>

                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums" style={{ color: VIZ.textPrimary }}>
                  {formatUsdCompact(a.buyValue)}
                </td>

                <td
                  className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
                  style={{ color: netPositive ? VIZ.buyText : VIZ.sellText }}
                  title={netPositive ? "Net accumulation" : "Net disposal"}
                >
                  {netPositive ? "▲" : "▼"} {formatUsdCompact(Math.abs(a.netValue))}
                </td>

                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums" style={{ color: VIZ.textSecondary }}>
                  {a.politicianCount}
                </td>

                <td className="whitespace-nowrap px-2 py-2 text-xs">
                  <span className="inline-flex items-center gap-2">
                    {(["D", "R", "I"] as const).map((p) =>
                      a.partySplit[p] > 0 ? (
                        <span key={p} className="inline-flex items-center gap-1">
                          <span
                            aria-hidden
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: partyStyle(p).mark }}
                          />
                          <span className="tabular-nums" style={{ color: partyStyle(p).text }}>
                            {p} {a.partySplit[p]}
                          </span>
                        </span>
                      ) : null,
                    )}
                    {a.partySplit.D === 0 && a.partySplit.R === 0 && a.partySplit.I === 0 && (
                      <span style={{ color: VIZ.textMuted }}>Not disclosed</span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
