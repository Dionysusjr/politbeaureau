"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Snapshot } from "@/lib/types";
import { formatUsdCompact } from "@/lib/amounts";
import { formatRelativeTime } from "@/lib/format";
import { VIZ } from "@/lib/viz-tokens";
import DataBanner from "@/components/DataBanner";
import StatTile from "@/components/StatTile";
import TierBadge, { TierLegend } from "@/components/TierBadge";
import PoliticianLeaderboard from "@/components/PoliticianLeaderboard";
import TradeTape from "@/components/TradeTape";
import AssetTable from "@/components/AssetTable";
import FilterBar, { EMPTY_FILTERS, Filters } from "@/components/FilterBar";

const POLL_MS = Number(process.env.NEXT_PUBLIC_CONGRESS_POLL_MS ?? 30000);

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
};

export default function CongressDashboard() {
  const { data, error, isLoading } = useSWR<Snapshot>("/api/congress/snapshot", fetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const politicians = useMemo(() => {
    const all = data?.politicians ?? [];
    const q = filters.search.trim().toLowerCase();
    return all.filter((p) => {
      if (filters.chamber !== "all" && p.chamber !== filters.chamber) return false;
      if (filters.party !== "all" && p.party !== filters.party) return false;
      if (filters.tier !== "all" && p.tier !== filters.tier) return false;
      if (q && !`${p.name} ${p.state} ${p.role}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data?.politicians, filters]);

  const assets = useMemo(() => {
    const all = data?.assets ?? [];
    const q = filters.search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((a) => `${a.ticker ?? ""} ${a.name}`.toLowerCase().includes(q));
  }, [data?.assets, filters.search]);

  const trades = useMemo(() => {
    const all = data?.recentTrades ?? [];
    const q = filters.search.trim().toLowerCase();
    const allowed = new Set(politicians.map((p) => p.id));
    return all.filter((t) => {
      if (filters.chamber !== "all" || filters.party !== "all" || filters.tier !== "all") {
        if (!allowed.has(t.politicianId)) return false;
      }
      if (q && !`${t.politicianName} ${t.ticker ?? ""} ${t.assetName}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [data?.recentTrades, politicians, filters]);

  if (error && !data) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <h1 className="text-xl font-semibold" style={{ color: VIZ.textPrimary }}>
          Capitol Ledger
        </h1>
        <p
          className="mt-4 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: `${VIZ.sellMark}4d`, backgroundColor: `${VIZ.sellMark}14`, color: VIZ.sellText }}
        >
          Could not load the snapshot: {String(error.message ?? error)}
        </p>
      </main>
    );
  }

  const stats = data?.stats;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: VIZ.textPrimary }}>
              Capitol Ledger
            </h1>
            <p className="mt-1 text-sm" style={{ color: VIZ.textSecondary }}>
              What US politicians and executive-branch officials disclose buying and selling —
              stocks, ETFs, bonds, funds, options and crypto — ranked by estimated portfolio size.
            </p>
          </div>
        </div>

        {data && (
          <DataBanner
            dataState={data.dataState}
            generatedAt={data.generatedAt}
            marketOpen={data.marketOpen}
            sources={data.sources}
            warnings={data.warnings}
            lastUpdatedLabel={formatRelativeTime(data.generatedAt)}
          />
        )}
      </header>

      {isLoading && !data && (
        <p className="text-sm" style={{ color: VIZ.textMuted }}>
          Loading disclosures…
        </p>
      )}

      {stats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile
            label="Disclosed volume"
            value={formatUsdCompact(stats.totalDisclosedValue)}
            sublabel="bracket midpoints"
          />
          <StatTile
            label="Buys"
            value={formatUsdCompact(stats.buyValue)}
            delta={{ direction: "up", text: `${stats.totalTrades} trades` }}
          />
          <StatTile label="Sells" value={formatUsdCompact(stats.sellValue)} delta={{ direction: "down", text: "disposals" }} />
          <StatTile label="Filers" value={String(stats.politicianCount)} sublabel={`${stats.assetCount} assets`} />
          <StatTile label="New this week" value={String(stats.newThisWeek)} sublabel="by filing date" />
          <StatTile
            label="Avg filing lag"
            value={`${stats.avgFilingDelayDays}d`}
            sublabel="45-day limit"
          />
        </section>
      )}

      <FilterBar filters={filters} onChange={setFilters} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
              Portfolio leaderboard
            </h2>
            <span className="text-xs" style={{ color: VIZ.textMuted }}>
              {politicians.length} filer{politicians.length === 1 ? "" : "s"} · estimated size
            </span>
          </div>

          <div className="mb-3">
            <TierLegend counts={stats?.tierCounts} />
          </div>

          <PoliticianLeaderboard politicians={politicians} max={30} />
        </section>

        <section
          className="rounded-xl border p-4"
          style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
              Most-traded assets
            </h2>
            <span className="text-xs" style={{ color: VIZ.textMuted }}>
              by disclosed purchase value
            </span>
          </div>
          <AssetTable assets={assets} max={18} />
        </section>
      </div>

      <section
        className="rounded-xl border p-4"
        style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
            Latest disclosures
          </h2>
          <span className="text-xs" style={{ color: VIZ.textMuted }}>
            newest first · refreshes every {Math.round(POLL_MS / 1000)}s
          </span>
        </div>
        <TradeTape trades={trades} max={40} />
      </section>

      {data && data.recentFilings.length > 0 && (
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: VIZ.textSecondary }}>
              Filings received
            </h2>
            <span className="text-xs" style={{ color: VIZ.textMuted }}>
              primary sources · transaction detail may be PDF-only
            </span>
          </div>
          <ul className="divide-y" style={{ borderColor: VIZ.border }}>
            {data.recentFilings.slice(0, 20).map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="tabular-nums" style={{ color: VIZ.textMuted }}>
                  {f.filedDate}
                </span>
                <Link
                  href={`/politician/${f.politicianId}`}
                  className="font-medium hover:underline"
                  style={{ color: VIZ.textPrimary }}
                >
                  {f.politicianName}
                </Link>
                <span style={{ color: VIZ.textSecondary }}>{f.filingType}</span>
                <span className="text-xs" style={{ color: VIZ.textMuted }}>
                  {f.state}
                  {f.district ? `-${f.district}` : ""} · {f.chamber}
                </span>
                {f.detailInPdfOnly && (
                  <span className="text-xs" style={{ color: VIZ.textMuted }}>
                    detail in PDF
                  </span>
                )}
                {f.documentUrl && (
                  <a
                    href={f.documentUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs underline"
                    style={{ color: VIZ.series1 }}
                  >
                    source ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="pb-6 text-xs leading-relaxed" style={{ color: VIZ.textMuted }}>
        <p>
          Amounts are <strong>estimates</strong>. US disclosure law requires filers to report each
          transaction as a range (e.g. $1,001–$15,000), not an exact figure, so every dollar value
          here is derived from bracket midpoints and portfolio sizes are approximations used for
          ranking. Filing lag is the gap between transaction and disclosure; the STOCK Act allows up
          to 45 days.
        </p>
        <p className="mt-2">
          Nothing here is investment advice, and a disclosed trade is not evidence of wrongdoing.
          Verify against the primary filing before drawing conclusions.
        </p>
      </footer>
    </main>
  );
}
