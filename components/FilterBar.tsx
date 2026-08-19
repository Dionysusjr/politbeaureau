"use client";

import { PortfolioTier } from "@/lib/types";
import { TIER_ORDER, TIER_STYLE } from "@/lib/tiers";
import { VIZ } from "@/lib/viz-tokens";

/**
 * Dimension filters, in a single row above the charts. Selected state is carried
 * by a border/fill change plus the control's `aria-pressed`, so selection never
 * depends on colour alone.
 */

export interface Filters {
  search: string;
  chamber: "all" | "house" | "senate" | "executive";
  party: "all" | "D" | "R" | "I";
  tier: "all" | PortfolioTier;
}

export const EMPTY_FILTERS: Filters = { search: "", chamber: "all", party: "all", tier: "all" };

function Chip({
  active,
  onClick,
  children,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
      style={{
        borderColor: active ? (accent ?? VIZ.series1) : VIZ.border,
        backgroundColor: active ? `${accent ?? VIZ.series1}26` : "transparent",
        color: active ? (accent ? undefined : VIZ.textPrimary) : VIZ.textSecondary,
      }}
    >
      {children}
    </button>
  );
}

export default function FilterBar({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <input
        type="search"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
        placeholder="Search filer, ticker or asset…"
        className="w-56 rounded-lg border bg-transparent px-3 py-1.5 text-sm outline-none focus:ring-1"
        style={{ borderColor: VIZ.border, color: VIZ.textPrimary }}
        aria-label="Search filers and assets"
      />

      <div className="flex items-center gap-1.5">
        <span className="text-xs" style={{ color: VIZ.textMuted }}>
          Chamber
        </span>
        {(["all", "house", "senate", "executive"] as const).map((c) => (
          <Chip key={c} active={filters.chamber === c} onClick={() => set({ chamber: c })}>
            {c === "all" ? "All" : c === "house" ? "House" : c === "senate" ? "Senate" : "Executive"}
          </Chip>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs" style={{ color: VIZ.textMuted }}>
          Party
        </span>
        {(["all", "D", "R", "I"] as const).map((p) => (
          <Chip key={p} active={filters.party === p} onClick={() => set({ party: p })}>
            {p === "all" ? "All" : p}
          </Chip>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs" style={{ color: VIZ.textMuted }}>
          Tier
        </span>
        <Chip active={filters.tier === "all"} onClick={() => set({ tier: "all" })}>
          All
        </Chip>
        {TIER_ORDER.map((t) => (
          <Chip
            key={t}
            active={filters.tier === t}
            onClick={() => set({ tier: t })}
            accent={TIER_STYLE[t].mark}
          >
            <span style={{ color: filters.tier === t ? TIER_STYLE[t].text : undefined }}>
              {TIER_STYLE[t].label}
            </span>
          </Chip>
        ))}
      </div>

      {(filters.search || filters.chamber !== "all" || filters.party !== "all" || filters.tier !== "all") && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-xs underline"
          style={{ color: VIZ.textMuted }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
