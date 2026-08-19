/**
 * Disclosure amount brackets.
 *
 * Filers never report an exact figure for a transaction — they check a box for a
 * range. These are the ranges used on House PTRs / Senate PTRs under the STOCK
 * Act and the Ethics in Government Act. Everything downstream ranks on the
 * bracket midpoint, which is an estimate and is labelled as such in the UI.
 */
export interface AmountBracket {
  min: number;
  max: number;
  label: string;
}

export const AMOUNT_BRACKETS: AmountBracket[] = [
  { min: 1, max: 1_000, label: "$1 - $1,000" },
  { min: 1_001, max: 15_000, label: "$1,001 - $15,000" },
  { min: 15_001, max: 50_000, label: "$15,001 - $50,000" },
  { min: 50_001, max: 100_000, label: "$50,001 - $100,000" },
  { min: 100_001, max: 250_000, label: "$100,001 - $250,000" },
  { min: 250_001, max: 500_000, label: "$250,001 - $500,000" },
  { min: 500_001, max: 1_000_000, label: "$500,001 - $1,000,000" },
  { min: 1_000_001, max: 5_000_000, label: "$1,000,001 - $5,000,000" },
  { min: 5_000_001, max: 25_000_000, label: "$5,000,001 - $25,000,000" },
  { min: 25_000_001, max: 50_000_000, label: "$25,000,001 - $50,000,000" },
  // Top bracket is open-ended on the form. We cap it so midpoints stay finite;
  // the UI shows the "+" so nobody reads the cap as a reported ceiling.
  { min: 50_000_001, max: 100_000_000, label: "Over $50,000,000" },
];

/**
 * Midpoint of a bracket. For the open-ended top bracket we use the floor rather
 * than a midpoint of an invented ceiling, to avoid inflating a filer's total on
 * the strength of a number nobody disclosed.
 */
export function bracketMidpoint(min: number, max: number): number {
  const top = AMOUNT_BRACKETS[AMOUNT_BRACKETS.length - 1];
  if (top && min >= top.min) return min;
  if (!Number.isFinite(max) || max <= 0) return min;
  return Math.round((min + max) / 2);
}

/** Find the bracket a raw dollar figure falls into. */
export function bracketFor(value: number): AmountBracket {
  const found = AMOUNT_BRACKETS.find((b) => value >= b.min && value <= b.max);
  return found ?? AMOUNT_BRACKETS[AMOUNT_BRACKETS.length - 1]!;
}

function toNumber(raw: string): number {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse an amount range as it appears in filings and aggregator payloads.
 * Handles "$1,001 - $15,000", "$1,001–$15,000", "Over $50,000,000",
 * "$50,000,001 +", and bare single values.
 */
export function parseAmountRange(raw: string | null | undefined): AmountBracket {
  if (!raw) return { min: 0, max: 0, label: "Undisclosed" };
  const text = raw.replace(/–|—/g, "-").trim();

  const pair = text.match(/\$?\s*([\d,.]+)\s*-\s*\$?\s*([\d,.]+)/);
  if (pair?.[1] && pair[2]) {
    const min = toNumber(pair[1]);
    const max = toNumber(pair[2]);
    return { min, max, label: canonicalLabel(min, max) };
  }

  // Open-ended forms are bracket *labels*, so snap them onto the canonical
  // bracket that starts at the stated floor.
  //
  // "Over $X" excludes X itself — the top box on the form reads "Over
  // $50,000,000" and its floor is $50,000,001 — whereas "$X +" includes X.
  // Treating them the same yields a floor one dollar low and a degenerate
  // "$50M - $50M" range that matches no real bracket.
  const over = text.match(/(?:over|above|more than|greater than)\s*\$?\s*([\d,.]+)/i);
  const plus = text.match(/\$?\s*([\d,.]+)\s*\+/);
  if (over?.[1] || plus?.[1]) {
    const floor = over?.[1] ? toNumber(over[1]) + 1 : toNumber(plus![1]!);
    const bracket = AMOUNT_BRACKETS.find((b) => b.min === floor) ?? bracketFor(floor);
    return { min: bracket.min, max: bracket.max, label: bracket.label };
  }

  const single = text.match(/\$?\s*([\d,.]+)/);
  if (single?.[1]) {
    const value = toNumber(single[1]);
    const bracket = bracketFor(value);
    return { ...bracket };
  }

  return { min: 0, max: 0, label: "Undisclosed" };
}

/** Snap arbitrary min/max bounds onto the canonical bracket label. */
export function canonicalLabel(min: number, max: number): string {
  const exact = AMOUNT_BRACKETS.find((b) => b.min === min && b.max === max);
  if (exact) return exact.label;
  const top = AMOUNT_BRACKETS[AMOUNT_BRACKETS.length - 1]!;
  if (min >= top.min) return top.label;
  return `${formatUsdCompact(min)} - ${formatUsdCompact(max)}`;
}

export function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
