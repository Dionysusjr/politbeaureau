"use client";

import Link from "next/link";
import useSWR from "swr";
import { PoliticianDetail } from "@/lib/types";
import { formatUsd, formatUsdCompact } from "@/lib/amounts";
import { ASSET_CLASS_LABEL, OWNER_LABEL, TRADE_TYPE_LABEL } from "@/lib/normalize";
import { formatRelativeTime } from "@/lib/format";
import { VIZ, partyStyle } from "@/lib/viz-tokens";
import { TIER_STYLE } from "@/lib/tiers";
import { assetHref } from "@/lib/links";
import TierBadge from "@/components/TierBadge";
import StatTile from "@/components/StatTile";

const POLL_MS = Number(process.env.NEXT_PUBLIC_CONGRESS_POLL_MS ?? 30000);

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
};

export default function PoliticianProfile({ params }: { params: { id: string } }) {
  const { data, error, isLoading } = useSWR<PoliticianDetail>(
    `/api/congress/politician/${params.id}`,
    fetcher,
    { refreshInterval: POLL_MS, keepPreviousData: true },
  );

  if (error && !data) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <Link href="/" className="text-xs underline" style={{ color: VIZ.textMuted }}>
          ← Back to dashboard
        </Link>
        <p
          className="mt-4 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: `${VIZ.sellMark}4d`, backgroundColor: `${VIZ.sellMark}14`, color: VIZ.sellText }}
        >
          {String(error.message ?? error)}
        </p>
      </main>
    );
  }

  if (isLoading && !data) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm" style={{ color: VIZ.textMuted }}>
          Loading filer…
        </p>
      </main>
    );
  }

  if (!data) return null;

  const party = partyStyle(data.party);
  const tier = TIER_STYLE[data.tier];
  const classMax = Math.max(...data.assetClassMix.map((c) => c.value), 1);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Link href="/" className="text-xs underline" style={{ color: VIZ.textMuted }}>
        ← Back to dashboard
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: VIZ.textPrimary }}>
            {data.name}
          </h1>
          <TierBadge tier={data.tier} />
          <span className="text-sm" style={{ color: VIZ.textMuted }}>
            Rank #{data.rank} by estimated portfolio
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={{ color: VIZ.textSecondary }}>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: party.mark }} />
            <span style={{ color: party.text }}>{party.label}</span>
          </span>
          <span>{data.role}</span>
          <span>
            {data.state}
            {data.district ? `, district ${data.district}` : ""}
          </span>
          <span className="capitalize">{data.chamber}</span>
        </div>

        {data.committees.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span style={{ color: VIZ.textMuted }}>Committees:</span>
            {data.committees.map((c) => (
              <span
                key={c}
                className="rounded-full border px-2 py-0.5"
                style={{ borderColor: VIZ.border, color: VIZ.textSecondary }}
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Est. portfolio"
          value={formatUsdCompact(data.portfolioValue)}
          sublabel={`${formatUsdCompact(data.portfolioValueMin)}–${formatUsdCompact(data.portfolioValueMax)}`}
        />
        <StatTile label="Trades" value={String(data.tradeCount)} sublabel={`${data.uniqueAssets} assets`} />
        <StatTile label="Bought" value={formatUsdCompact(data.buyValue)} delta={{ direction: "up", text: `${data.purchaseCount}` }} />
        <StatTile label="Sold" value={formatUsdCompact(data.sellValue)} delta={{ direction: "down", text: `${data.saleCount}` }} />
        <StatTile label="Avg filing lag" value={`${data.avgFilingDelayDays}d`} sublabel="45-day limit" />
        <StatTile
          label="Last trade"
          value={data.lastTradeDate ?? "—"}
          sublabel={data.lastTradeDate ? formatRelativeTime(`${data.lastTradeDate}T12:00:00Z`) : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Holdings — magnitude on a shared scale, anchored to a common baseline */}
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
        >
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
            Estimated positions
          </h2>
          <p className="mb-3 text-xs" style={{ color: VIZ.textMuted }}>
            Net disclosed flow per asset (purchases minus sales)
          </p>

          <ul className="space-y-2">
            {data.holdings.slice(0, 20).map((h) => {
              const max = Math.max(...data.holdings.map((x) => Math.abs(x.netValue)), 1);
              const widthPct = Math.max(1.5, (Math.abs(h.netValue) / max) * 100);
              const positive = h.netValue >= 0;
              // A net below the smallest reportable bracket ($1,001) is rounding
              // noise from midpoint arithmetic, not a position — say so rather
              // than rendering a bogus "$1" holding.
              const closedOut = Math.abs(h.netValue) < 1_001 && h.tradeCount > 1;
              return (
                <li key={`${h.ticker ?? h.assetName}`}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <Link
                      href={assetHref(h)}
                      className="min-w-0 truncate hover:underline"
                      style={{ color: VIZ.textPrimary }}
                      title={h.assetName}
                    >
                      {h.ticker ?? h.assetName}
                    </Link>
                    <span
                      className="shrink-0 tabular-nums"
                      style={{ color: closedOut ? VIZ.textMuted : positive ? VIZ.buyText : VIZ.sellText }}
                      title={
                        closedOut
                          ? "Disclosed purchases and sales offset — no net position in this window"
                          : undefined
                      }
                    >
                      {closedOut ? "≈ closed out" : `${positive ? "" : "−"}${formatUsdCompact(Math.abs(h.netValue))}`}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-sm" style={{ backgroundColor: VIZ.gridline }}>
                    <div
                      className="h-full rounded-r"
                      style={{
                        width: closedOut ? "0%" : `${widthPct}%`,
                        backgroundColor: positive ? VIZ.buyMark : VIZ.sellMark,
                      }}
                    />
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: VIZ.textMuted }}>
                    {ASSET_CLASS_LABEL[h.assetClass]} · {h.tradeCount} trade
                    {h.tradeCount === 1 ? "" : "s"} · last {h.lastTradeDate}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Asset-class mix: same magnitude form, one scale */}
          <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
            Asset-class mix
          </h3>
          <ul className="space-y-1.5">
            {data.assetClassMix.map((c) => (
              <li key={c.assetClass} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span style={{ color: VIZ.textSecondary }}>{ASSET_CLASS_LABEL[c.assetClass]}</span>
                  <span className="tabular-nums" style={{ color: VIZ.textPrimary }}>
                    {formatUsdCompact(c.value)}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-sm" style={{ backgroundColor: VIZ.gridline }}>
                  <div
                    className="h-full rounded-r"
                    style={{ width: `${Math.max(1.5, (c.value / classMax) * 100)}%`, backgroundColor: VIZ.series1 }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Full trade history */}
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
            Disclosed transactions ({data.trades.length})
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs" style={{ color: VIZ.textMuted }}>
                <tr className="border-b" style={{ borderColor: VIZ.border }}>
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Asset</th>
                  <th className="px-2 py-2 font-medium">Action</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="px-2 py-2 text-right font-medium">Lag</th>
                </tr>
              </thead>
              <tbody>
                {data.trades.map((t) => {
                  const isBuy = t.type === "purchase" || t.type === "exchange";
                  return (
                    <tr key={t.id} className="border-b last:border-0" style={{ borderColor: VIZ.border }}>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums" style={{ color: VIZ.textSecondary }}>
                        {t.transactionDate}
                      </td>
                      <td className="max-w-[13rem] px-2 py-2">
                        <Link href={assetHref(t)} className="hover:underline" style={{ color: VIZ.textPrimary }}>
                          {t.ticker ?? ASSET_CLASS_LABEL[t.assetClass]}
                        </Link>
                        <div className="truncate text-xs" style={{ color: VIZ.textMuted }} title={t.assetName}>
                          {t.assetName}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <span style={{ color: isBuy ? VIZ.buyText : VIZ.sellText }}>
                          {isBuy ? "▲" : "▼"} {TRADE_TYPE_LABEL[t.type]}
                        </span>
                        {t.owner !== "unknown" && (
                          <div className="text-xs" style={{ color: VIZ.textMuted }}>
                            {OWNER_LABEL[t.owner]}
                          </div>
                        )}
                      </td>
                      <td
                        className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
                        style={{ color: VIZ.textPrimary }}
                        title={`Reported bracket: ${t.amountRange}`}
                      >
                        {t.amountRange}
                      </td>
                      <td
                        className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
                        style={{ color: t.filingDelayDays > 45 ? VIZ.sellText : VIZ.textMuted }}
                      >
                        {t.filingDelayDays}d
                        {t.filingUrl && (
                          <a
                            href={t.filingUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="ml-2 underline"
                            style={{ color: VIZ.series1 }}
                          >
                            ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <footer className="pb-6 text-xs leading-relaxed" style={{ color: VIZ.textMuted }}>
        Amounts are reported as ranges, so <strong>{formatUsd(data.portfolioValue)}</strong> is a
        midpoint-derived estimate (plausible span{" "}
        {formatUsdCompact(data.portfolioValueMin)}–{formatUsdCompact(data.portfolioValueMax)}), not a
        reported figure. Positions reflect only what has been disclosed in this dataset's window —
        assets held without a reported transaction do not appear.
      </footer>
    </main>
  );
}
