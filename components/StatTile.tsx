import { VIZ } from "@/lib/viz-tokens";

/**
 * Stat tile — a headline figure with no plot. The value wears text ink, never a
 * series colour; the optional delta carries a direction word so the sign never
 * depends on colour alone.
 */
export default function StatTile({
  label,
  value,
  sublabel,
  delta,
}: {
  label: string;
  value: string;
  sublabel?: string;
  delta?: { direction: "up" | "down"; text: string };
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ borderColor: VIZ.border, backgroundColor: VIZ.surfaceRaised }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: VIZ.textMuted }}>
        {label}
      </div>
      {/* Long values (dates, party splits) drop a step rather than wrapping. */}
      <div
        className={`mt-1 font-semibold ${value.length > 9 ? "text-lg" : "text-2xl"}`}
        style={{ color: VIZ.textPrimary }}
      >
        {value}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
        {delta && (
          <span
            className="font-medium"
            style={{ color: delta.direction === "up" ? VIZ.buyText : VIZ.sellText }}
          >
            {delta.direction === "up" ? "▲" : "▼"} {delta.text}
          </span>
        )}
        {sublabel && <span style={{ color: VIZ.textMuted }}>{sublabel}</span>}
      </div>
    </div>
  );
}
