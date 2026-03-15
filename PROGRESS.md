# Apify Lead Enricher — Project Board

## To Do

### Phase 1 — Repo Setup & Scaffolding

    - due: 2026-03-22
    - tags: [setup, scaffolding, prerequisite]
    - priority: high
    - workload: Easy
    - steps:
      - [ ] Initialise repo with `apify-cli` (`apify create apify-property-lead-enricher --template typescript`)
      - [ ] Set up TypeScript config (`tsconfig.json`)
      - [ ] Install dependencies (`apify`, `crawlee`, `playwright`, `cheerio`)
      - [ ] Create `src/types.ts` with `LeadRecord` interface
      - [ ] Create `INPUT_SCHEMA.json`
      - [ ] Create `Dockerfile` using Apify’s Node.js base image
      - [ ] Configure `apify.json` metadata
      - [ ] Add `.gitignore` (`node_modules`, `.env`, `apify_storage`)
      
      ```md
      Run `apify create` first — it scaffolds the Dockerfile and apify.json automatically.
      Only customise after the base scaffold is in place.
      ```

### Phase 2 — Companies House Module

    - due: 2026-03-24
    - tags: [api, companies-house, seed-source]
    - priority: high
    - workload: Easy
    - steps:
      - [ ] Get Companies House API key from developer.company-information.service.gov.uk
      - [ ] Build `companiesHouse.ts` — company search by name/postcode (`GET /search/companies`)
      - [ ] Build officers lookup — director names + appointment dates (`GET /company/{id}/officers`)
      - [ ] Filter results by property SIC codes: 68100, 68209, 68320, 41100
      - [ ] Unit test with sample Cardiff postcodes
      
      ```md
      This is the seed source — every other module depends on its output.
      Build and validate this fully before moving to Phase 3.
      ```

### Phase 3 — Land Registry Module

    - due: 2026-03-26
    - tags: [api, land-registry, portfolio-value]
    - priority: high
    - workload: Easy
    - steps:
      - [ ] Explore HMLR Price Paid Data API at landregistry.data.gov.uk
      - [ ] Build `landRegistry.ts` — lookup by company name
      - [ ] Build `landRegistry.ts` — lookup by postcode
      - [ ] Derive `totalTransactions` and `estimatedPortfolioValue` (sum of pricePaid)
      - [ ] Unit test with known property investor company names
      
      ```md
      No auth required. Uses JSON-LD / SPARQL endpoint.
      High-value signal: transaction volume = investor activity level.
      ```

### Phase 4 — Rightmove / Zoopla Scraper

    - due: 2026-03-29
    - tags: [scraping, playwright, proxies, anti-blocking]
    - priority: medium
    - workload: Medium
    - steps:
      - [ ] Set up `PlaywrightCrawler` with Apify residential proxies
      - [ ] Build `propertyListings.ts` — search by agent/landlord name from Companies House output
      - [ ] Extract active listing count and property type distribution
      - [ ] Add randomised delays between 2000–5000ms per request
      - [ ] Cap at 3 pages per run to limit compute units
      - [ ] Test anti-blocking with 10 sample runs
      
      ```md
      Most expensive module in terms of compute units (Playwright = full browser).
      Keep page depth shallow. Residential proxies are mandatory here.
      ```

### Phase 5 — LinkedIn Module

    - due: 2026-04-01
    - tags: [scraping, cheerio, proxies, linkedin]
    - priority: medium
    - workload: Medium
    - steps:
      - [ ] Set up `CheerioCrawler` with Apify residential proxies
      - [ ] Build `linkedin.ts` — search by director name + “property” keyword (public pages only)
      - [ ] Extract LinkedIn URL, current role, and current company
      - [ ] Hard cap at 30 lookups per Actor run
      - [ ] Enforce 3s minimum delay between requests
      - [ ] Skip lookups where director name is fewer than 3 words (too common)
      - [ ] Test rate limiting — confirm no blocks after 30 consecutive lookups
      
      ```md
      Build this last. Most fragile module. Never login-scrape.
      Public profile pages only. If blocks occur, reduce cap to 15/run.
      ```

### Phase 6 — Orchestrator & Merge

    - due: 2026-04-03
    - tags: [orchestrator, core, merge]
    - priority: high
    - workload: Medium
    - steps:
      - [ ] Build `main.ts` — wire all modules via `Promise.allSettled()`
      - [ ] Build `merge.ts` — combine partial source records into unified `LeadRecord`
      - [ ] Add `Actor.setStatusMessage()` at key checkpoints for Console visibility
      - [ ] Add global retry handler with exponential backoff for all HTTP requests
      - [ ] Add deduplication via Apify Key-Value Store (check `registrationNumber` before re-enriching)
      - [ ] End-to-end test run with real postcode input
      
      ```md
      Use Promise.allSettled() not Promise.all() — a failing source must never crash the full run.
      Dedup key is registrationNumber (unique, stable, from first source).
      ```

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

*(Nothing in progress yet — starting from Phase 1.)*

-----

## Done

*(No phases complete yet.)*

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