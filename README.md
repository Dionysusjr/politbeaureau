# Capitol Ledger — US political trading disclosures

A live dashboard of what US politicians and executive-branch officials disclose
buying and selling — stocks, ETFs, bonds, municipal bonds, treasuries, mutual
funds, options, REITs, crypto and IPO allocations — with per-filer profiles,
per-asset price history, and filers ranked by estimated portfolio size.

**Auto-refreshes every 30 seconds.** Built with Next.js 14 (App Router) +
TypeScript + Tailwind CSS.

## Publish it to the internet

The fastest route to a public, shareable link is Vercel — free tier, no config
files needed:

1. Go to **[vercel.com/new](https://vercel.com/new)**, sign in with GitHub, and
   import the **`politbeaureau`** repo (grant access if prompted). Vercel
   detects Next.js automatically — accept every default.
2. Expand **Environment Variables** and add one:
   `CONTACT_EMAIL` = your email address. The SEC's fair-access policy requires
   requests to identify their sender, and the House/Senate sites behave better
   with one too.
3. Click **Deploy**. About two minutes later you get a public URL like
   `https://politbeaureau-xxxx.vercel.app` — that is the link to share. Anyone
   who opens it sees the page refresh itself every 30 seconds.

Every later push to `main` redeploys automatically; other branches get their own
preview URLs.

**A deployed site never shows placeholder data.** In production the app defaults
to strict `live` mode: the simulator cannot run, prices come from real market
data, and if an upstream source is unavailable the page shows an honest
"LIVE MODE — AWAITING DATA" state with per-source diagnostics rather than
inventing filers.

## Prefer Google Apps Script?

There is a complete rewrite of this dashboard in **[`apps-script/`](apps-script/)**
that runs entirely inside Google Apps Script and publishes as a Web App — no
Node, no npm, no hosting account. Same views, same tier colours, same data
sources. See [`apps-script/README.md`](apps-script/README.md) for the
step-by-step deployment.

## Views

- **Dashboard** (`/`) — headline stats, a portfolio-size leaderboard, the
  most-traded assets, a live tape of the latest disclosures (new rows flash),
  and a feed of filings received from primary sources. Filter by chamber,
  party, tier, or free-text search.
- **Filer profile** (`/politician/<id>`) — estimated portfolio and tier, rank,
  buy/sell totals, average filing lag, estimated positions per asset,
  asset-class mix, and every disclosed transaction with its reported bracket.
- **Asset view** (`/asset/<ticker>`) — price history charted with each disclosed
  political purchase and sale marked on the timeline (hover for a crosshair and
  detail), performance over 1W/1M/3M/6M/1Y, net flow, party mix, the full list
  of politicians who traded it, and recent SEC Form 4 corporate-insider filings
  for context.

## Running locally

```bash
npm install
cp .env.example .env   # dev defaults to auto mode + simulated prices
npm run dev            # http://localhost:3000
```

```bash
npm run build && npm start   # production build (strict live mode)
npm run typecheck            # type-only check
npm run verify:parsers       # 34 fixture-based parser checks
```

## Portfolio tiers

Filers are ranked by **estimated portfolio value** and banded into four tiers:

| Tier | Band | Colour |
| --- | --- | --- |
| `MEGA` | $5M+ | gold `#af913c` |
| `LARGE` | $1M – $5M | green `#008300` |
| `MEDIUM` | $250K – $1M | blue `#3987e5` |
| `SMALL` | under $250K | red `#e12323` |

Thresholds live in one place — `TIER_FLOOR` in `lib/congress/tiers.ts`.

Those four hexes were chosen by validating candidates against this app's
`#0b1220` surface, not by eye: all clear the dark lightness band, the chroma
floor, the all-pairs normal-vision separation floor (worst ΔE 20.0) and 3:1
contrast. The gold↔red pair sits in the 6–8 colour-vision-deficiency band, which
is only acceptable alongside secondary encoding — so **every tier badge renders
its tier name as text**, and colour never carries the tier alone. Keep that
property if you re-theme.

## Amounts are estimates, and the UI says so

US disclosure law makes filers report each transaction as a **range**
(`$1,001 – $15,000`, `$50,001 – $100,000`, …), never an exact figure. So:

- every dollar value in this app is derived from **bracket midpoints**;
- the open-ended top bracket ("Over $50,000,000") uses its **floor**, not a
  midpoint of an invented ceiling, so nobody's total is inflated by a number
  that was never disclosed;
- "estimated portfolio" is net retained disclosed flow (purchases minus sales,
  floored at zero per position) — it is **not** a portfolio statement, and
  assets held without a reported transaction never appear;
- `Since 1st buy` on the asset page compares the latest close to the close on
  the filer's first disclosed purchase date. It is deliberately **not** labelled
  a return: real position size, cost basis and undisclosed activity are unknown.

A disclosed trade is not evidence of wrongdoing, and none of this is investment
advice.

## Data sources

Set via `CONGRESS_DATA_SOURCE` (`auto` | `simulated` | `live`):

- `auto` — live sources with simulator fallback (**default in development**);
- `simulated` — simulator only, for local demos;
- `live` — **strict: the simulator never runs** (**default in production**, so
  a published site can never show placeholder data). If no source has returned
  transactions, the page renders a clear "LIVE MODE — AWAITING DATA" state with
  per-source diagnostics instead of placeholder filers, and keeps retrying on
  the normal refresh cycle. The same strictness applies to prices: in live
  mode a failed price fetch shows no chart rather than a synthetic series.

Every source runs concurrently and independently, so one dead upstream degrades
the dashboard instead of breaking it — per-source health is shown in the UI
banner, including failures and which keys are missing.

### Free primary sources (no API key)

| Source | Endpoint | Yields |
| --- | --- | --- |
| House Clerk PTR index | `disclosures-clerk.house.gov/public_disc/financial-pdfs/<YEAR>FD.zip` | **Filings + roster only** |
| Senate eFD | `efd.senate.gov` (CSRF handshake → DataTables JSON → report HTML) | **Filings + ticker-level trades** |
| SEC EDGAR Form 4 | `www.sec.gov` / `data.sec.gov` | Corporate-insider context |

**The House limitation is load-bearing.** The Clerk's ZIP contains a
machine-readable XML index of *filings* — filer, filing type, state/district,
date, document id — but the individual transaction rows (ticker, amount bracket,
buy/sell) exist only inside each PTR **PDF**, many of which are scans requiring
OCR. So the House provider populates the filings feed and roster and never
fabricates trades. For real ticker-level House data, use an aggregator below (they
run the PDF extraction) or add your own PDF+OCR pipeline.

Senate *electronic* PTRs render transactions as an HTML table, so those are
parsed into real trades. Paper filings are scanned images and yield a filing
record with no transactions.

Set `CONTACT_EMAIL` before enabling live sources: the SEC's fair-access policy
requires a contact address in the User-Agent, and the House/Senate sites behave
better with one.

### Commercial aggregators (enabled by the presence of their key)

`QUIVER_API_KEY`, `UNUSUAL_WHALES_API_KEY`, `FMP_API_KEY`, `FINNHUB_API_KEY`,
`CONGRESSINVESTS_API_KEY`, `LAMBDA_API_KEY`.

These are the practical route to ticker-level House data. Because their exact
response shapes are behind paywalls and change, all six pipe through **one
tolerant field mapper** (`lib/congress/providers/loose.ts`) that accepts many
aliases per field (`transaction_date` / `transactionDate` / `Transaction Date`,
`amount` / `amountFrom`+`amountTo`, …) and drops rows lacking a usable minimum
rather than inventing zero-value trades. A vendor renaming a field degrades one
column instead of breaking the integration. Endpoint paths are overridable via
env (`QUIVER_CONGRESS_URL` etc.) so a moved route doesn't need a code change.

Note that Finnhub's congressional endpoint is **symbol-scoped**, so it cannot
produce a global feed on its own — it enriches specific tickers.

Records are merged and deduped on a natural transaction key, with primary
sources winning over aggregators when both describe the same filing.

### Simulator (default, zero setup)

When no live source returns transactions, the dashboard falls back to a
deterministic simulator and marks the snapshot **SIMULATED**.

**Its filers are fictional on purpose.** Attributing invented transactions to
real, named officials would manufacture financial records about identifiable
people — a screenshot of that is misinformation regardless of any banner — so the
demo dataset uses invented filers with realistic structure (chamber, party,
state, district, committees). Real officials' names appear only when a live
source is configured and returns actual filings. Tickers are real symbols, which
is fine: they identify securities, not people.

The simulator has two layers: a stable historical corpus anchored to today's date
(so the view doesn't reshuffle on every poll), plus a **live tape** keyed to
45-second wall-clock buckets, so new disclosures genuinely arrive over time and
the auto-refresh has something real to show.

### Price history

`PRICE_DATA_SOURCE` = `synthetic` (default in dev) | `stooq` (free daily CSV,
no key — default in production) | `yahoo`. In `auto`/`simulated` modes a failed
fetch falls back to a deterministic synthetic series flagged `SIMULATED PRICE`;
in strict `live` mode it shows no price data at all. Fetches are cached
per-ticker for 10 minutes so a public page doesn't hammer the price upstream.

## Polling and caching

The browser polls every 30s (`NEXT_PUBLIC_CONGRESS_POLL_MS`), but the **server**
refreshes upstream on a much longer cycle (`SNAPSHOT_TTL_MS`, default 5 min live
/ 10s simulated). Without that split, N open dashboards would mean N × (House ZIP
download + Senate handshake + report fetches) every 30 seconds — slow, and a bad
citizen against rate-limited government endpoints.

The cache (`lib/congress/cache.ts`) serves a stale value while a refresh runs in
the background and single-flights concurrent loads. It is **in-process**: it
resets on restart and is per-instance, so wire up Redis if you run several
instances behind a load balancer.

## Deploying elsewhere

Deploys anywhere Next.js runs (Node host, Docker, Render, Fly.io):
`npm run build && npm start`. Production defaults to strict live mode
automatically. The API routes declare `maxDuration` (60s) because the House ZIP
download outruns serverless default timeouts. The in-process cache means each
warm serverless instance keeps its own copy — fine for one region; add Redis for
heavy traffic.

## Verifying the parsers

```bash
npm run verify:parsers
```

The endpoints above are frequently unreachable — corporate egress policies
commonly block `*.house.gov` / `*.senate.gov`, and the commercial APIs need keys
— which makes the parsers the part most likely to be wrong and hardest to check.
`scripts/verify-parsers.ts` exercises them against fixtures modelled on each
source's documented shape: House index XML, a Senate PTR HTML table (including a
reordered-column variant), aggregator payloads in three key styles, amount
brackets, tier boundaries and the aggregation rollups. 34 checks.

This validates **parsing and normalisation, not live endpoint behaviour** —
upstream markup and field names can still drift.

Three real bugs were caught by these fixtures during development, which is a fair
indication of what to expect if you extend the parsers:

- `"Over $50,000,000"` parsed to a floor of `$50,000,000`, one dollar low,
  producing a degenerate `$50M–$50M` range matching no real bracket;
- the Senate column resolver matched `Asset Type` before `Type` on a substring
  search, silently reading the security's class as the transaction direction and
  turning **every sale into a purchase**;
- `inferAssetClass` claimed anything called an "index fund" as an ETF.

## Layout

```
app/                           dashboard (/), /politician/[id], /asset/[id]
app/api/congress/              snapshot, politician, asset, insiders routes
components/congress/           tier badges, leaderboard, tape, price chart, filters
lib/congress/
  types.ts                     domain model
  tiers.ts                     tier thresholds + validated palette
  amounts.ts                   disclosure brackets + midpoint maths
  normalize.ts                 name/ticker/date/type normalisation + dedupe keys
  aggregate.ts                 politician, asset and stats rollups
  service.ts                   cached IO + per-view aggregation
  cache.ts                     TTL cache with stale-while-revalidate
  prices.ts                    price history providers + synthetic fallback
  providers/
    index.ts                   orchestration, merge, dedupe, fallback
    house-clerk.ts             ZIP + XML index parsing
    senate-efd.ts              CSRF handshake + PTR HTML parsing
    aggregators.ts             six commercial APIs
    loose.ts                   tolerant field mapper
    sec-form4.ts               EDGAR Form 4
    simulated.ts               deterministic simulator + live tape
scripts/verify-parsers.ts      fixture-based parser checks
```

## Known gaps

- **House ticker-level data needs an aggregator or an OCR pipeline** (see above).
- **OGE presidential/executive filings** (`extapps2.oge.gov`) and **OGE
  Integrity** (`integrity.gov`) are modelled in the source taxonomy but not
  implemented as providers: Integrity is a JS app whose JSON search API needs a
  session, and the OGE 201 filings are PDFs with the same OCR problem as the
  House. Executive-branch filers appear in the model and simulator, so wiring a
  provider in requires no schema change.
- **Apify actors** and the **Trump Tracker Supabase** table are likewise not
  implemented — the former is pay-per-use with per-actor output shapes, the
  latter depends on that project's row-level security allowing anonymous reads,
  which needs confirming before it can be relied on. Both would slot in as
  ordinary providers returning `Trade[]`.
- Market-holiday calendars are not modelled, so the "US market open" indicator
  reads a holiday as open.
- No persistence: history and cache live in process memory.

## Provenance

Extracted from [`Dionysusjr/Analysis`](https://github.com/Dionysusjr/Analysis),
where it lived at `/congress` alongside a Jamaican dividend-stock dashboard.
