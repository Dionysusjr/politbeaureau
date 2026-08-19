import { slugify } from "./normalize";

/**
 * Route helper for asset pages.
 *
 * Must agree with `assetKey` in aggregate.ts: tickered assets route by ticker,
 * untickered ones by a slug of their description. Keeping this in one place stops
 * links drifting out of sync with the grouping key.
 */
export function assetHref(asset: { ticker?: string; assetName?: string; name?: string }): string {
  if (asset.ticker) return `/asset/${encodeURIComponent(asset.ticker)}`;
  const name = asset.assetName ?? asset.name ?? "";
  return `/asset/${encodeURIComponent(`n-${slugify(name).slice(0, 48)}`)}`;
}
