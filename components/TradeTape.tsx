"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Trade } from "@/lib/types";
import { formatUsdCompact } from "@/lib/amounts";
import { TRADE_TYPE_LABEL, OWNER_LABEL, ASSET_CLASS_LABEL } from "@/lib/normalize";
import { VIZ } from "@/lib/viz-tokens";
import { assetHref } from "@/lib/links";

/**
 * Live tape of the most recent disclosures.
 *
 * Rows that arrive between polls flash once, so the 30s refresh is legible
 * without the user diffing the list themselves. Buy/sell is carried by a word
 * ("Purchase" / "Sale") as well as the polarity colour.
 */
export default function TradeTape({ trades, max = 40 }: { trades: Trade[]; max?: number }) {
  const rows = trades.slice(0, max);
  const seenRef = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    const incoming = rows.map((t) => t.id);
    // First render shouldn't flash the whole list — only genuinely new rows.
    if (!primed.current) {
      seenRef.current = new Set(incoming);
      primed.current = true;
      return;
    }

    const added = incoming.filter((id) => !seenRef.current.has(id));
    if (added.length === 0) return;

    for (const id of incoming) seenRef.current.add(id);
    setFresh(new Set(added));
    const timer = setTimeout(() => setFresh(new Set()), 1500);
    return () => clearTimeout(timer);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="px-1 py-6 text-sm" style={{ color: VIZ.textMuted }}>
        No disclosures in this view.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-sm">
        <thead className="text-xs" style={{ color: VIZ.textMuted }}>
          <tr className="border-b" style={{ borderColor: VIZ.border }}>
            <th className="px-2 py-2 font-medium">Filer</th>
            <th className="px-2 py-2 font-medium">Asset</th>
            <th className="px-2 py-2 font-medium">Action</th>
            <th className="px-2 py-2 text-right font-medium">Amount</th>
            <th className="px-2 py-2 font-medium">Traded</th>
            <th className="px-2 py-2 text-right font-medium">Filed after</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const isBuy = t.type === "purchase" || t.type === "exchange";
            return (
              <tr
                key={t.id}
                className={`border-b last:border-0 ${fresh.has(t.id) ? (isBuy ? "animate-flashGreen" : "animate-flashRed") : ""}`}
                style={{ borderColor: VIZ.border }}
              >
                <td className="max-w-[12rem] truncate px-2 py-2">
                  <Link
                    href={`/politician/${t.politicianId}`}
                    className="hover:underline"
                    style={{ color: VIZ.textPrimary }}
                  >
                    {t.politicianName}
                  </Link>
                  <span className="ml-1 text-xs" style={{ color: VIZ.textMuted }}>
                    {t.state}
                  </span>
                </td>

                <td className="max-w-[16rem] px-2 py-2">
                  <Link href={assetHref(t)} className="hover:underline" style={{ color: VIZ.textPrimary }}>
                    {t.ticker ?? <span className="italic">{ASSET_CLASS_LABEL[t.assetClass]}</span>}
                  </Link>
                  <div className="truncate text-xs" style={{ color: VIZ.textMuted }} title={t.assetName}>
                    {t.assetName}
                  </div>
                </td>

                <td className="whitespace-nowrap px-2 py-2">
                  <span style={{ color: isBuy ? VIZ.buyText : VIZ.sellText }}>
                    {isBuy ? "▲" : "▼"} {TRADE_TYPE_LABEL[t.type]}
                  </span>
                  {t.owner !== "unknown" && t.owner !== "self" && (
                    <span className="ml-1 text-xs" style={{ color: VIZ.textMuted }}>
                      ({OWNER_LABEL[t.owner]})
                    </span>
                  )}
                </td>

                <td
                  className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
                  style={{ color: VIZ.textPrimary }}
                  title={t.amountRange}
                >
                  {formatUsdCompact(t.amountMin)}–{formatUsdCompact(t.amountMax)}
                </td>

                <td className="whitespace-nowrap px-2 py-2 tabular-nums" style={{ color: VIZ.textSecondary }}>
                  {t.transactionDate}
                </td>

                <td
                  className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
                  style={{ color: t.filingDelayDays > 45 ? VIZ.sellText : VIZ.textMuted }}
                  title={
                    t.filingDelayDays > 45
                      ? "Beyond the STOCK Act's 45-day reporting window"
                      : "Days between transaction and disclosure"
                  }
                >
                  {t.filingDelayDays}d
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
