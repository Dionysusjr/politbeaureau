"use client";

import Link from "next/link";
import useSWR from "swr";
import { AssetDetail } from "@/lib/types";
import { formatUsdCompact } from "@/lib/amounts";
import { ASSET_CLASS_LABEL, OWNER_LABEL, TRADE_TYPE_LABEL } from "@/lib/normalize";
import { VIZ, partyStyle } from "@/lib/viz-tokens";
import TierBadge from "@/components/TierBadge";
import StatTile from "@/components/StatTile";
import PriceChart from "@/components/PriceChart";

const POLL_MS = Number(process.env.NEXT_PUBLIC_CONGRESS_POLL_MS ?? 30000);

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
};

interface InsiderResponse {
  ticker: string;
  filings: Array<{ form: string; filedDate: string; documentUrl: string; reportDate?: string }>;
  warning?: string;
  disabled?: boolean;
}

export default function AssetPage({ params }: { params: { id: string } }) {
  const { data, error, isLoading } = useSWR<AssetDetail>(
    `/api/congress/asset/${params.id}`,
    fetcher,
    { refreshInterval: POLL_MS, keepPreviousData: true },
  );

  // Insider filings are a slow, daily-cadence feed — fetched once per ticker,
  // not on the dashboard poll interval.
  const { data: insiders } = useSWR<InsiderResponse>(
    data?.ticker ? `/api/congress/insiders/${data.ticker}` : null,
    fetcher,
    { revalidateOnFocus: false },
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
          Loading asset…
        </p>
      </main>
    );
  }

  if (!data) return null;

  const quote = data.quote;
  const netPositive = data.netValue >= 0;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Link href="/" className="text-xs underline" style={{ color: VIZ.textMuted }}>
        ← Back to dashboard
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: VIZ.textPrimary }}>
            {data.ticker ?? data.name}
          </h1>
          <span
            className="rounded-full border px-2 py-0.5 text-xs"
            style={{ borderColor: VIZ.border, color: VIZ.textSecondary }}
          >
            {ASSET_CLASS_LABEL[data.assetClass]}
          </span>
          {quote && (
            <span className="flex items-baseline gap-2">
              <span className="text-xl font-semibold tabular-nums" style={{ color: VIZ.textPrimary }}>
                ${quote.price.toFixed(2)}
              </span>
              <span
                className="text-sm tabular-nums"
                style={{ color: quote.changePct >= 0 ? VIZ.buyText : VIZ.sellText }}
              >
                {quote.changePct >= 0 ? "▲" : "▼"} {Math.abs(quote.changePct).toFixed(2)}%
              </span>
              {!quote.isLive && (
                <span
                  className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                  style={{ borderColor: "#af913c80", backgroundColor: "#af913c1f", color: "#e0c063" }}
                >
                  SIMULATED PRICE
                </span>
              )}
            </span>
          )}
        </div>
        {data.ticker && (
          <p className="text-sm" style={{ color: VIZ.textSecondary }}>
            {data.name}
          </p>
        )}
      </header>

      {/* Performance windows — derived from the close series */}
      {data.history.length > 1 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.performance.map((p) => (
            <StatTile
              key={p.label}
              label={p.label}
              value={p.changePct === null ? "n/a" : `${p.changePct >= 0 ? "+" : ""}${p.changePct.toFixed(1)}%`}
              sublabel={p.changePct === null ? "not enough history" : undefined}
            />
          ))}
        </section>
      )}

      {data.ticker ? (
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
        >
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
            Price history &amp; disclosed political trades
          </h2>
          <p className="mb-3 text-xs" style={{ color: VIZ.textMuted }}>
            Markers sit on the close for the transaction date. Hover for detail.
          </p>
          <PriceChart history={data.history} trades={data.trades} isLive={quote?.isLive ?? false} />
        </section>
      ) : (
        <section
          className="rounded-xl border p-4 text-sm"
          style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised, color: VIZ.textMuted }}
        >
          This asset has no ticker in the disclosure record — municipal bonds, mutual funds and
          private holdings have no public market price, so there is no performance history to chart.
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Disclosed buys" value={formatUsdCompact(data.buyValue)} sublabel={`${data.purchaseCount} trades`} />
        <StatTile label="Disclosed sells" value={formatUsdCompact(data.sellValue)} sublabel={`${data.saleCount} trades`} />
        <StatTile
          label="Net flow"
          value={formatUsdCompact(Math.abs(data.netValue))}
          delta={{ direction: netPositive ? "up" : "down", text: netPositive ? "accumulating" : "distributing" }}
        />
        <StatTile label="Filers" value={String(data.politicianCount)} sublabel={`${data.buyerCount} buyers`} />
        <StatTile
          label="Party mix"
          value={`${data.partySplit.D}D · ${data.partySplit.R}R${data.partySplit.I ? ` · ${data.partySplit.I}I` : ""}`}
        />
        <StatTile label="Last trade" value={data.lastTradeDate} />
      </section>

      {/* Who traded it */}
      <section
        className="rounded-xl border p-4"
        style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
          Politicians who traded {data.ticker ?? "this asset"} ({data.traders.length})
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="text-xs" style={{ color: VIZ.textMuted }}>
              <tr className="border-b" style={{ borderColor: VIZ.border }}>
                <th className="px-2 py-2 font-medium">Filer</th>
                <th className="px-2 py-2 font-medium">Tier</th>
                <th className="px-2 py-2 text-right font-medium">Bought</th>
                <th className="px-2 py-2 text-right font-medium">Sold</th>
                <th className="px-2 py-2 text-right font-medium">Trades</th>
                <th className="px-2 py-2 font-medium">First buy</th>
                <th className="px-2 py-2 text-right font-medium">Since 1st buy</th>
              </tr>
            </thead>
            <tbody>
              {data.traders.map((t) => {
                const party = partyStyle(t.party);
                return (
                  <tr key={t.politicianId} className="border-b last:border-0" style={{ borderColor: VIZ.border }}>
                    <td className="px-2 py-2">
                      <Link
                        href={`/politician/${t.politicianId}`}
                        className="font-medium hover:underline"
                        style={{ color: VIZ.textPrimary }}
                      >
                        {t.politicianName}
                      </Link>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: party.mark }} />
                        <span style={{ color: party.text }}>{t.party === "unknown" ? "—" : t.party}</span>
                        <span style={{ color: VIZ.textMuted }}>
                          {t.state} · {t.chamber}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <TierBadge tier={t.tier} size="sm" />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums" style={{ color: VIZ.buyText }}>
                      {t.buyValue > 0 ? formatUsdCompact(t.buyValue) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums" style={{ color: VIZ.sellText }}>
                      {t.sellValue > 0 ? formatUsdCompact(t.sellValue) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums" style={{ color: VIZ.textSecondary }}>
                      {t.tradeCount}
                    </td>
                    <td className="px-2 py-2 tabular-nums" style={{ color: VIZ.textSecondary }}>
                      {t.firstTradeDate}
                    </td>
                    <td
                      className="px-2 py-2 text-right tabular-nums"
                      style={{
                        color:
                          t.returnSinceFirstBuyPct === undefined
                            ? VIZ.textMuted
                            : t.returnSinceFirstBuyPct >= 0
                              ? VIZ.buyText
                              : VIZ.sellText,
                      }}
                      title="Price change since their first disclosed purchase. Illustrative only — brackets hide real position size and cost basis."
                    >
                      {t.returnSinceFirstBuyPct === undefined
                        ? "n/a"
                        : `${t.returnSinceFirstBuyPct >= 0 ? "+" : ""}${t.returnSinceFirstBuyPct.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* All transactions in this asset */}
      <section
        className="rounded-xl border p-4"
        style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
          All disclosed transactions ({data.trades.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-sm">
            <thead className="text-xs" style={{ color: VIZ.textMuted }}>
              <tr className="border-b" style={{ borderColor: VIZ.border }}>
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Filer</th>
                <th className="px-2 py-2 font-medium">Action</th>
                <th className="px-2 py-2 text-right font-medium">Reported range</th>
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
                    <td className="px-2 py-2">
                      <Link
                        href={`/politician/${t.politicianId}`}
                        className="hover:underline"
                        style={{ color: VIZ.textPrimary }}
                      >
                        {t.politicianName}
                      </Link>
                      {t.owner !== "unknown" && t.owner !== "self" && (
                        <span className="ml-1 text-xs" style={{ color: VIZ.textMuted }}>
                          ({OWNER_LABEL[t.owner]})
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2" style={{ color: isBuy ? VIZ.buyText : VIZ.sellText }}>
                      {isBuy ? "▲" : "▼"} {TRADE_TYPE_LABEL[t.type]}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums" style={{ color: VIZ.textPrimary }}>
                      {t.amountRange}
                    </td>
                    <td
                      className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
                      style={{ color: t.filingDelayDays > 45 ? VIZ.sellText : VIZ.textMuted }}
                    >
                      {t.filingDelayDays}d
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Corporate insider context — a different disclosure regime, kept separate */}
      {data.ticker && insiders && insiders.filings.length > 0 && (
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
        >
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
            Corporate insider filings (SEC Form 4)
          </h2>
          <p className="mb-3 text-xs" style={{ color: VIZ.textMuted }}>
            Company officers, directors and 10% owners — a separate regime from congressional
            disclosure, shown for context and not merged into the figures above.
          </p>
          <ul className="flex flex-wrap gap-2">
            {insiders.filings.slice(0, 12).map((f) => (
              <li key={f.documentUrl}>
                <a
                  href={f.documentUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs hover:bg-white/5"
                  style={{ borderColor: VIZ.border, color: VIZ.textSecondary }}
                >
                  <span className="tabular-nums">{f.filedDate}</span>
                  <span style={{ color: VIZ.series1 }}>Form {f.form} ↗</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="pb-6 text-xs leading-relaxed" style={{ color: VIZ.textMuted }}>
        Transaction values are reported as ranges, so totals here are midpoint estimates. &ldquo;Since
        1st buy&rdquo; compares the latest close to the close on the filer&rsquo;s first disclosed
        purchase date — it is <strong>not</strong> a return figure: the actual position size, cost
        basis and any undisclosed activity are unknown. A disclosed trade is not evidence of
        wrongdoing.
      </footer>
    </main>
  );
}
