# Capitol Ledger — Google Apps Script edition

The same dashboard, rewritten to run entirely inside **Google Apps Script** and
published as a Web App. No Node, no npm, no hosting account: the script fetches
the disclosures, stores them in Google's cache, and serves the page itself.

**Auto-refreshes every 30 seconds** in every visitor's browser.

This is a port of the Next.js app in the repository root — same data model, same
tier colours, same views. See [What changed in the port](#what-changed-in-the-port)
for how the platform forced the architecture to differ.

---

## Deploy it (about 10 minutes)

### 1. Create the project

Go to **[script.google.com/home/projects/create](https://script.google.com/home/projects/create)**.
Rename it (top left) to something you'll recognise, e.g. `Capitol Ledger`.

### 2. Add the files

In the editor's left sidebar, use **+ → Script** for each `.gs` file and
**+ → HTML** for each `.html` file, naming them **exactly** as below, then paste
in the contents. Apps Script adds the extension itself, so type `Amounts`, not
`Amounts.gs`.

| Script files (`.gs`) | HTML files |
| --- | --- |
| `Config`, `Amounts`, `Normalize`, `Tiers`, `Aggregate` | `Index` |
| `Html`, `Http`, `Store`, `Prices` | `Styles` |
| `Provider_House`, `Provider_Senate`, `Provider_Aggregators` | `App` |
| `Refresh`, `Code` | |

Delete the default `Code.gs` stub first, or paste this project's `Code.gs` over it.

> **Faster alternative:** if you have [clasp](https://github.com/google/clasp),
> run `clasp login`, then `clasp create --type webapp --title "Capitol Ledger"`,
> copy `.clasp.json.example` to `.clasp.json` with your script id, and
> `clasp push`. That uploads every file including `appsscript.json`.

### 3. Show the manifest and paste it in

**Project Settings** (gear icon) → tick **"Show appsscript.json manifest file in
editor"**. Go back to the editor, open `appsscript.json`, and replace its
contents with this project's version. That sets the V8 runtime, the web app
access level, and the two OAuth scopes the script needs.

### 4. Set your contact address

**Project Settings → Script properties → Add script property:**

| Property | Value |
| --- | --- |
| `CONTACT_EMAIL` | your email address |

The SEC's fair-access policy requires requests to identify their sender, and the
House and Senate sites behave better with one. Add aggregator keys here too (see
[Getting real trade data](#getting-real-trade-data)).

You can also open `Config.gs`, edit the values in `setupProperties()`, and run
that function once — same result.

### 5. Fetch the first snapshot

In the editor, pick **`refreshSnapshot`** from the function dropdown and click
**Run**. Google will ask you to authorise the script — it needs
`script.external_request` (to reach the disclosure sites) and `script.scriptapp`
(to install its own trigger). On the "Google hasn't verified this app" screen,
choose **Advanced → Go to <your project> (unsafe)**; that warning appears for
every unpublished personal script, and you are the author.

Watch the execution log. You should see something like
`Refresh complete: 412 trades, 96 filers, 486213 bytes in 6 chunks, 48213ms`.

### 6. Install the refresh trigger

Run **`setupTrigger`** once. That installs a time-driven trigger calling
`refreshSnapshot` every 10 minutes. Re-running it is safe — it removes its own
previous trigger first rather than stacking duplicates that quietly burn quota.

### 7. Publish

**Deploy → New deployment → ⚙ → Web app**, then:

- **Execute as:** `Me`
- **Who has access:** `Anyone` ← this is what makes the link public

Click **Deploy** and copy the **Web app URL**. It looks like
`https://script.google.com/macros/s/AKfy…long…/exec`. **That is your shareable
link.** Anyone who opens it sees the dashboard, refreshing every 30 seconds.

> After editing any file, you must **Deploy → Manage deployments → ✏️ → Version:
> New version → Deploy**. Saving the editor alone does not update the live URL.

---

## Views

- **Dashboard** — headline stats, the portfolio-size leaderboard, most-traded
  assets, a live tape of the latest disclosures (new rows flash), and the
  filings feed. Filter by chamber, party, tier or free text.
- **Filer profile** — estimated portfolio and tier, rank, buy/sell totals,
  filing lag, estimated positions per asset, asset-class mix, full transactions.
- **Asset view** — price history with every disclosed purchase and sale marked
  on the timeline (hover for a crosshair and detail), 1W–1Y performance, net
  flow, party mix, and everyone who traded it.

Navigation inside the page is client-side. Deep links work through query
parameters on the published URL:

```
…/exec?view=asset&id=AAPL
…/exec?view=politician&id=sen-jane-doe
…/exec?api=snapshot            ← raw JSON, handy for debugging
```

## Portfolio tiers

| Tier | Band | Colour |
| --- | --- | --- |
| `MEGA` | $5M+ | gold `#af913c` |
| `LARGE` | $1M – $5M | green `#008300` |
| `MEDIUM` | $250K – $1M | blue `#3987e5` |
| `SMALL` | under $250K | red `#e12323` |

Thresholds live in one place — `TIER_FLOOR` in `Tiers.gs`.

Those four hexes were chosen by validating candidates against this app's
`#0b1220` surface, not by eye: all clear the dark lightness band, the chroma
floor, the all-pairs normal-vision separation floor (worst ΔE 20.0) and 3:1
contrast. The gold↔red pair sits in the 6–8 colour-vision-deficiency band, which
is only acceptable alongside secondary encoding — so **every tier badge renders
its tier name as text**, and colour never carries the tier alone. Keep that
property if you re-theme.

## Amounts are estimates, and the UI says so

US disclosure law makes filers report each transaction as a **range**
(`$1,001 – $15,000`, …), never an exact figure. So:

- every dollar value is derived from **bracket midpoints**;
- the open-ended top bracket ("Over $50,000,000") uses its **floor**, not a
  midpoint of an invented ceiling, so nobody's total is inflated by a number
  that was never disclosed;
- "estimated portfolio" is net retained disclosed flow (purchases minus sales,
  floored at zero per position) — not a portfolio statement. Assets held without
  a reported transaction never appear;
- "Since 1st buy" compares the latest close to the close on the filer's first
  disclosed purchase. It is deliberately **not** labelled a return: real position
  size, cost basis and undisclosed activity are unknown.

A disclosed trade is not evidence of wrongdoing, and none of this is investment
advice.

## No placeholder data, by construction

**This port has no simulator and no synthetic prices at all** — not disabled by
a flag, simply absent from the codebase. If no source returns anything, the page
shows `LIVE MODE — AWAITING DATA` with per-source diagnostics. If a price fetch
fails, the asset shows no chart rather than an invented line.

## Data sources

Every source runs independently, so one dead upstream degrades the dashboard
rather than breaking it. Each one's health — including the error it returned and
how long it took — is shown in the source panel behind the "N sources active"
button.

### Free, no API key

| Source | Yields |
| --- | --- |
| House Clerk PTR index (`disclosures-clerk.house.gov`) | **Filings + roster only** |
| Senate eFD (`efd.senate.gov`) | **Filings + ticker-level trades** |

**The House limitation is load-bearing.** The Clerk's ZIP contains a
machine-readable XML index of *filings* — filer, type, state/district, date, doc
id — but the transaction rows (ticker, bracket, buy/sell) exist only inside each
PTR **PDF**, many of them scans needing OCR. So the House provider fills the
filings feed and the roster and never fabricates trades.

Senate *electronic* PTRs render transactions as an HTML table, so those parse
into real trades. Paper filings are scanned images and yield a filing with no
rows. Reaching that endpoint needs a CSRF + cookie handshake, which the script
performs by hand because `UrlFetchApp` does not keep cookies.

### Getting real trade data

For ticker-level House data, add one aggregator key as a Script property:

| Property | Vendor |
| --- | --- |
| `FMP_API_KEY` | [Financial Modeling Prep](https://site.financialmodelingprep.com) |
| `QUIVER_API_KEY` | [Quiver Quantitative](https://www.quiverquant.com) |
| `UNUSUAL_WHALES_API_KEY` | [Unusual Whales](https://unusualwhales.com) |
| `FINNHUB_API_KEY` | [Finnhub](https://finnhub.io) — symbol-scoped, enriches tickers others surface |

These vendors do the PDF extraction the free sources can't. Because their
response shapes sit behind paywalls and change, all of them pipe through **one
tolerant field mapper** in `Provider_Aggregators.gs` that accepts many aliases
per field and drops rows lacking a usable minimum rather than inventing
zero-value trades.

Never hard-code a key into a `.gs` file — anyone you give edit access can read
the source. Script properties are the right place.

### Prices

`PRICE_DATA_SOURCE` = `stooq` (default, free daily CSV, no key) or `none`.
Fetched per ticker and cached for six hours, so an asset page doesn't hammer the
upstream.

## What changed in the port

Apps Script is a different runtime, and these are forced, not stylistic:

| Next.js version | Apps Script version | Why |
| --- | --- | --- |
| `fetch` | `UrlFetchApp` | No `fetch`; needs `muteHttpExceptions` so a 404 is a response, not a throw |
| `fflate` | `Utilities.unzip` | No npm |
| `cheerio` (XML) | `XmlService` | No npm; built in |
| `cheerio` (HTML) | regex table parser in `Html.gs` | `XmlService` rejects real-world HTML |
| React + SWR | vanilla JS in `App.html` | No bundler |
| `fetch('/api/…')` | `google.script.run` | The page runs in a sandboxed iframe on a *different origin*, so a plain fetch back to the web app is blocked by CORS |
| In-process TTL cache | `CacheService`, chunked | Caps a value at 100KB; a snapshot is bigger, so it is split across numbered keys |
| `maxDuration` on API routes | time-driven trigger | A request can't wait on these sources, so the refresh runs on its own schedule |
| Separate URL routes | one page + `?view=` deep links | A Web App has a single `doGet` |

The last two are the significant ones. **Nothing fetches upstream during a page
view.** The trigger refreshes on its own schedule and every visitor is served the
stored snapshot, so the page responds instantly no matter how slow the
disclosure sites are — which matters more here than it did on a server, because
the House ZIP plus a Senate handshake can take the better part of a minute.

## Limits worth knowing

- **Script runtime:** 6 minutes per execution. `refreshSnapshot` is bounded by
  `CONFIG.SENATE_MAX_REPORTS` (20) to stay inside it. Raise it only if your logs
  show plenty of headroom.
- **UrlFetchApp:** 20,000 calls/day on a consumer account. A 10-minute trigger
  uses roughly 150–900/day depending on sources.
- **CacheService:** 100KB per value, 6-hour maximum lifetime. Hence chunking, and
  a durable copy in Script Properties so a cold start after a quiet night serves
  the last good snapshot instead of an empty page.
- **The "unverified app" warning** on first authorisation is normal for a
  personal script and does not affect visitors to the published URL.

## Verifying the logic

```bash
node test/verify.js      # from this directory
```

Apps Script can't run outside Google, so the harness loads every `.gs` file into
one shared scope — exactly how the platform treats them — with shims for the
services they touch. 42 checks covering the amount brackets, normalisation, the
House XML parser, the Senate table parser, the tolerant aggregator mapper,
tiering, aggregation and the chunked cache round-trip.

This validates **parsing and logic, not live endpoint behaviour** — upstream
markup and field names can still drift. It also catches the failure mode unique
to this platform: a name collision between two files sharing one global scope.

## File map

```
Config.gs                 script properties, constants, setupProperties()
Amounts.gs                disclosure brackets + midpoint maths
Normalize.gs              name/ticker/date/type normalisation + dedupe keys
Tiers.gs                  tier thresholds + validated palette
Aggregate.gs              filer, asset and stats rollups
Html.gs                   regex table extraction + column resolution
Http.gs                   UrlFetchApp wrapper, cookie jar, form encoding
Provider_House.gs         ZIP + XmlService index parsing
Provider_Senate.gs        CSRF handshake + PTR table parsing
Provider_Aggregators.gs   commercial APIs + tolerant field mapper
Prices.gs                 stooq daily closes, cached per ticker
Store.gs                  chunked snapshot storage
Refresh.gs                trigger-driven fetch, merge, dedupe, assemble
Code.gs                   doGet web app entry + google.script.run API
Index.html / Styles.html / App.html    the page
test/verify.js            42 checks with Apps Script shims
```

## Known gaps

- **House ticker-level data needs an aggregator or an OCR pipeline** (above).
- **OGE presidential/executive filings** and **OGE Integrity** are modelled in
  the source taxonomy but not implemented: Integrity's JSON search needs a
  session, and the OGE 201 filings are PDFs with the same OCR problem.
- Market-holiday calendars are not modelled, so the "US market open" indicator
  reads a holiday as open.
- The Senate provider rides an undocumented internal endpoint, and neither it
  nor the House download has been exercised against the live sites from the
  environment this was written in — only against fixtures.
