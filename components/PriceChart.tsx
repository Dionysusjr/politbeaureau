"use client";

import { useMemo, useRef, useState } from "react";
import { PricePoint, Trade } from "@/lib/types";
import { VIZ } from "@/lib/viz-tokens";
import { formatUsdCompact } from "@/lib/amounts";

/**
 * Price history with disclosed political transactions marked on the timeline.
 *
 * Three marks, so a legend is present: the price line (single continuous series),
 * plus purchase and sale markers placed at their transaction date. Markers carry
 * a 2px surface ring because they overlap the line and each other. Hover gives a
 * crosshair and tooltip — an HTML chart is interactive by default.
 *
 * One y-axis only: markers are positioned on the price scale at the close for
 * their date, never on a second scale of transaction size.
 */

const W = 860;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

interface Marker {
  x: number;
  y: number;
  isBuy: boolean;
  date: string;
  trades: Trade[];
}

export default function PriceChart({
  history,
  trades,
  isLive,
}: {
  history: PricePoint[];
  trades: Trade[];
  isLive: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { min, max, points, xOf, yOf } = useMemo(() => {
    const closes = history.map((p) => p.close);
    const lo = Math.min(...closes);
    const hi = Math.max(...closes);
    // Pad the domain by 6% so the line never touches the frame.
    const span = hi - lo || hi || 1;
    const domainMin = Math.max(0, lo - span * 0.06);
    const domainMax = hi + span * 0.06;

    const xOf = (i: number) =>
      PAD.left + (history.length <= 1 ? plotW / 2 : (i / (history.length - 1)) * plotW);
    const yOf = (v: number) =>
      PAD.top + plotH - ((v - domainMin) / (domainMax - domainMin || 1)) * plotH;

    return {
      min: domainMin,
      max: domainMax,
      points: history.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.close).toFixed(1)}`).join(" "),
      xOf,
      yOf,
    };
  }, [history, plotH, plotW]);

  // Place each trade on the price scale at its transaction date, grouping
  // same-date/same-direction trades into one marker so dense weeks stay legible.
  const markers = useMemo<Marker[]>(() => {
    if (history.length === 0) return [];
    const indexByDate = new Map(history.map((p, i) => [p.date, i]));
    const grouped = new Map<string, Marker>();

    for (const t of trades) {
      let idx = indexByDate.get(t.transactionDate);
      if (idx === undefined) {
        // Trade date isn't a trading day (or predates the series) — snap forward.
        const found = history.findIndex((p) => p.date >= t.transactionDate);
        if (found < 0) continue;
        idx = found;
      }
      const isBuy = t.type === "purchase" || t.type === "exchange";
      const key = `${idx}:${isBuy}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.trades.push(t);
      } else {
        grouped.set(key, {
          x: xOf(idx),
          y: yOf(history[idx]!.close),
          isBuy,
          date: history[idx]!.date,
          trades: [t],
        });
      }
    }

    return [...grouped.values()];
  }, [trades, history, xOf, yOf]);

  const yTicks = useMemo(() => {
    const count = 4;
    return Array.from({ length: count + 1 }, (_, i) => min + ((max - min) * i) / count);
  }, [min, max]);

  const xTicks = useMemo(() => {
    if (history.length === 0) return [];
    const count = Math.min(6, history.length);
    return Array.from({ length: count }, (_, i) => {
      const idx = Math.round((i / (count - 1 || 1)) * (history.length - 1));
      return { idx, label: history[idx]!.date.slice(0, 7) };
    });
  }, [history]);

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || history.length === 0) return;
    const rect = svg.getBoundingClientRect();
    // Map client px onto the viewBox, then onto a data index.
    const xInView = ((event.clientX - rect.left) / rect.width) * W;
    const ratio = (xInView - PAD.left) / plotW;
    const idx = Math.round(ratio * (history.length - 1));
    setHoverIdx(Math.max(0, Math.min(history.length - 1, idx)));
  }

  if (history.length < 2) {
    return (
      <div
        className="flex h-48 items-center justify-center rounded-xl border text-sm"
        style={{ borderColor: VIZ.border, color: VIZ.textMuted }}
      >
        No price history available for this asset.
      </div>
    );
  }

  const hovered = hoverIdx === null ? null : history[hoverIdx];
  const hoveredMarkers = hoverIdx === null ? [] : markers.filter((m) => Math.abs(m.x - xOf(hoverIdx)) < 6);

  return (
    <div>
      {/* Legend — three marks on the plot, so identity is never colour-alone. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5" style={{ color: VIZ.textSecondary }}>
          <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: VIZ.series1 }} />
          Close {isLive ? "" : "(simulated)"}
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color: VIZ.textSecondary }}>
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VIZ.buyMark }} />
          Disclosed purchase
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color: VIZ.textSecondary }}>
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VIZ.sellMark }} />
          Disclosed sale
        </span>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "auto" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label="Price history with disclosed political transactions marked"
        >
          {/* Recessive gridlines + y axis labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yOf(v)}
                y2={yOf(v)}
                stroke={VIZ.gridline}
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={yOf(v) + 4} textAnchor="end" fontSize={11} fill={VIZ.textMuted}>
                {formatUsdCompact(v)}
              </text>
            </g>
          ))}

          {/* First and last labels anchor inward so they aren't clipped by the frame. */}
          {xTicks.map((t, i) => (
            <text
              key={t.idx}
              x={xOf(t.idx)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
              fontSize={11}
              fill={VIZ.textMuted}
            >
              {t.label}
            </text>
          ))}

          {/* Baseline */}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            stroke={VIZ.axis}
            strokeWidth={1}
          />

          {/* Price line — 2px, single series */}
          <polyline
            points={points}
            fill="none"
            stroke={VIZ.series1}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Crosshair */}
          {hoverIdx !== null && hovered && (
            <g>
              <line
                x1={xOf(hoverIdx)}
                x2={xOf(hoverIdx)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke={VIZ.textMuted}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle
                cx={xOf(hoverIdx)}
                cy={yOf(hovered.close)}
                r={5}
                fill={VIZ.series1}
                stroke={VIZ.surface}
                strokeWidth={2}
              />
            </g>
          )}

          {/* Trade markers — 2px surface ring since they overlap the line */}
          {markers.map((m) => (
            <circle
              key={`${m.date}-${m.isBuy}`}
              cx={m.x}
              cy={m.y}
              r={m.trades.length > 1 ? 6 : 4.5}
              fill={m.isBuy ? VIZ.buyMark : VIZ.sellMark}
              stroke={VIZ.surface}
              strokeWidth={2}
            />
          ))}
        </svg>

        {/* Tooltip */}
        {hoverIdx !== null && hovered && (
          <div
            className="pointer-events-none absolute z-10 min-w-[10rem] rounded-lg border px-3 py-2 text-xs shadow-lg"
            style={{
              borderColor: VIZ.border,
              backgroundColor: VIZ.surfaceRaised,
              color: VIZ.textPrimary,
              left: `calc(${(xOf(hoverIdx) / W) * 100}% + ${xOf(hoverIdx) > W / 2 ? -10.5 : 0.5}rem)`,
              top: 8,
            }}
          >
            <div className="tabular-nums" style={{ color: VIZ.textMuted }}>
              {hovered.date}
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums">
              ${hovered.close.toFixed(2)}
            </div>
            {hoveredMarkers.map((m) => (
              <div key={`${m.date}-${m.isBuy}`} className="mt-1 border-t pt-1" style={{ borderColor: VIZ.border }}>
                <span style={{ color: m.isBuy ? VIZ.buyText : VIZ.sellText }}>
                  {m.isBuy ? "▲ Purchase" : "▼ Sale"} ×{m.trades.length}
                </span>
                <div className="truncate" style={{ color: VIZ.textMuted }}>
                  {m.trades
                    .slice(0, 3)
                    .map((t) => t.politicianName)
                    .join(", ")}
                  {m.trades.length > 3 ? ` +${m.trades.length - 3}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
