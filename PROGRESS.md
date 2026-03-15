# Apify Lead Enricher — Project Board

## To Do

### Phase 7 — Storage & Integration

- due: 2026-04-05
- tags: [webhook, postgresql, truestage, integration]
- priority: high
- workload: Medium
- steps:
  - [ ] Confirm `Actor.pushData()` outputs correct `LeadRecord` schema
  - [ ] Build TrueStage webhook receiver at `/api/leads/ingest` (Next.js API route)
  - [ ] Write PostgreSQL upsert logic keyed on `registrationNumber`
  - [ ] Test full pipeline: Apify run → webhook → DB insert
  
  ```md
  Webhook fires on Actor run completion from Apify Console settings.
  Handler calls Apify API to fetch dataset, then upserts into Hetzner PostgreSQL.
  ```

### Phase 8 — Scheduling & Monitoring

    - due: 2026-04-07
    - tags: [scheduling, monitoring, devops]
    - priority: medium
    - workload: Easy
    - steps:
      - [ ] Set up weekly cron schedule in Apify Console (`0 8 * * 1` — Monday 08:00 UTC)
      - [ ] Set `maxResults: 50` cap per run to stay within Starter plan budget (~$1.45/run)
      - [ ] Configure email alerts for failed runs in Apify Console
      - [ ] Monitor first 3 scheduled runs manually before leaving unattended
      
      ```md
      50 leads/run × weekly = ~200 enriched leads/month well within $29 Starter plan budget.
      ```
    
-----

## In Progress

*(Nothing in progress — Phases 7–8 are next.)*

-----

## Done

### Phase 1 — Repo Setup & Scaffolding ✅

- `package.json` with apify, crawlee, playwright, cheerio, uuid
- `tsconfig.json` extending `@apify/tsconfig`
- `src/types.ts` — all interfaces (`LeadRecord`, `CompanyRecord`, `OfficerRecord`, `LandRegistryRecord`, `PropertyListing`, `LinkedInRecord`, `ActorInput`)
- `INPUT_SCHEMA.json` — searchQuery, searchType, enrichSources, maxResults, proxyConfiguration
- `Dockerfile` — Apify Playwright Chrome base image
- `apify.json` — Actor metadata
- `.gitignore` — node_modules, dist, apify_storage, .env

### Phase 2 — Companies House Module ✅

- `src/companiesHouse.ts` — company search via `/search/companies`, officers via `/company/{id}/officers`
- Filters by property SIC codes (68100, 68209, 68320, 41100)
- Exponential backoff retry on 429/failure (up to 3 retries)
- Basic auth via `COMPANIES_HOUSE_API_KEY` env var

### Phase 3 — Land Registry Module ✅

- `src/landRegistry.ts` — SPARQL queries against HMLR Price Paid Data endpoint
- Lookup by postcode or company name
- Derives `totalTransactions`, `estimatedPortfolioValue` (sum of pricePaid), `lastTransactionDate`
- Retry with exponential backoff on 429/5xx

### Phase 4 — Rightmove / Zoopla Scraper ✅

- `src/propertyListings.ts` — PlaywrightCrawler with Apify residential proxies
- Scrapes both Rightmove and Zoopla listing pages
- Randomised delays (2–5s) between requests
- Capped at 3 pages per crawl run

### Phase 5 — LinkedIn Module ✅

- `src/linkedin.ts` — CheerioCrawler with residential proxies
- Google search → LinkedIn public profile scrape pipeline
- Hard cap at 30 lookups per run, 3s minimum delay
- Skips names with fewer than 3 words (too common)

### Phase 6 — Orchestrator & Merge ✅

- `src/main.ts` — wires all modules via `Promise.allSettled()`
- `src/merge.ts` — combines partial records into unified `LeadRecord` with UUID
- `Actor.setStatusMessage()` at key checkpoints
- Deduplication via Apify Key-Value Store (keyed on `registrationNumber`)
- Each enrichment source runs in parallel; failures are isolated

-----

## Decisions Log

### 2026-03-15 — Use `Promise.allSettled()` over `Promise.all()`

- reason: A failing source (e.g. LinkedIn blocked) must never crash a full enrichment run
- impact: All modules must return a partial `LeadRecord | null`

### 2026-03-15 — Companies House as the seed source

- reason: Only official API in the pipeline — most reliable, no proxy needed, seeds all other modules
- impact: Actor cannot run without a valid Companies House result

### 2026-03-15 — Deduplication keyed on `registrationNumber`

- reason: Unique, stable, always available from the first source
- impact: Key-Value Store check happens before any other enrichment to avoid wasted compute

### 2026-03-15 — LinkedIn capped at 30 lookups per run

- reason: Avoid rate limiting on residential proxies; LinkedIn is the most fragile source
- impact: For large batch runs, LinkedIn enrichment will be partial — acceptable tradeoff