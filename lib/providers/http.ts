/**
 * Shared HTTP helpers for the disclosure providers.
 *
 * Government endpoints are slow and rate-limit aggressively, and several of them
 * reject requests without a descriptive User-Agent (SEC's fair-access policy
 * requires a contact address). Everything upstream-facing goes through here so
 * timeouts, retries and identification are consistent.
 */

const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * SEC requires a User-Agent identifying the caller with a contact address, and
 * the House/Senate sites behave better with one too. Set CONTACT_EMAIL so the
 * requests this app makes are attributable to whoever is running it.
 */
export function userAgent(): string {
  const contact = process.env.CONTACT_EMAIL?.trim();
  return contact
    ? `politician-trading-dashboard/0.1 (${contact})`
    : "politician-trading-dashboard/0.1 (set CONTACT_EMAIL to identify yourself)";
}

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  /** Retries on network error / 5xx / 429. */
  retries?: number;
}

export async function httpFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, headers, ...rest } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...rest,
        headers: {
          "User-Agent": userAgent(),
          "Accept-Encoding": "gzip, deflate",
          ...(headers ?? {}),
        },
        signal: controller.signal,
        cache: "no-store",
      });

      // Retry transient upstream conditions; return everything else as-is so the
      // caller can distinguish a 404 from a flaky gateway.
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `request to ${hostOf(url)} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function httpJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const res = await httpFetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${hostOf(url)} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function httpText(url: string, options: FetchOptions = {}): Promise<string> {
  const res = await httpFetch(url, options);
  if (!res.ok) throw new Error(`${hostOf(url)} returned HTTP ${res.status}`);
  return await res.text();
}

function backoffMs(attempt: number): number {
  return 400 * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
