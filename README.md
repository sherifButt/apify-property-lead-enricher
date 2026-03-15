# 🏠 UK Property Investor Lead Enricher

> An Apify Actor that turns a company name, postcode, or director name into a fully enriched, CRM-ready UK property investor lead — pulling from Companies House, Land Registry, Rightmove/Zoopla, and LinkedIn in a single run.

**Owner**: LoyalLeads LTD
**Stack**: Node.js · TypeScript · Apify SDK · Crawlee · Playwright
**Platform**: [Apify](https://apify.com)

-----

## What It Does

Identifying active UK property investors requires cross-referencing data spread across four separate sources. This Actor automates the entire enrichment pipeline:

|Source                |Data Extracted                                        |
|----------------------|------------------------------------------------------|
|**Companies House**   |Company name, registration number, SIC code, directors|
|**Land Registry**     |Transaction history, portfolio value, property types  |
|**Rightmove / Zoopla**|Active listings count, listing URLs                   |
|**LinkedIn**          |Director profile URL, current role, company           |

The output is a flat `LeadRecord` JSON object pushed to an Apify Dataset and optionally synced to a PostgreSQL database via webhook.

-----

## Architecture

```
INPUT (company | postcode | director)
        │
        ▼
┌─────────────────────┐
│   main.ts           │  ← Orchestrator
└──────┬──────────────┘
       │
       ├──── companiesHouse.ts  ──► Companies House REST API
       ├──── landRegistry.ts   ──► HMLR Price Paid Data API
       ├──── propertyListings.ts ─► Rightmove / Zoopla (Playwright)
       └──── linkedin.ts        ──► LinkedIn public profiles (Cheerio)
        │
        ▼
┌─────────────────────┐     ┌──────────────────────────┐
│   merge.ts          │────►│  Apify Dataset            │
└─────────────────────┘     └──────────┬───────────────┘
                                        │  webhook
                                        ▼
                             ┌──────────────────────┐
                             │  PostgreSQL           │
                             │  (TrueStage / CRM)    │
                             └──────────────────────┘
```

All source modules run in **parallel** via `Promise.allSettled()` — a failing source never crashes the full run.

-----

## Getting Started

### Prerequisites

- [Node.js 20+](https://nodejs.org)
- [Apify CLI](https://docs.apify.com/cli/) — `npm install -g apify-cli`
- [Companies House API key](https://developer.company-information.service.gov.uk)
- An Apify account (free tier works for testing)

### Install

```bash
git clone https://github.com/loyalleads/apify-property-lead-enricher.git
cd apify-property-lead-enricher
npm install
```

### Environment Variables

Create a `.env` file in the root (never commit this):

```env
COMPANIES_HOUSE_API_KEY=your_key_here
```

> `APIFY_PROXY_PASSWORD` is injected automatically by Apify at runtime — do not set it manually.

### Run Locally

```bash
apify run --input '{
  "searchQuery": "CF10",
  "searchType": "postcode",
  "enrichSources": ["companiesHouse", "landRegistry"],
  "maxResults": 10,
  "outputFormat": "json"
}'
```

For a full run including scraping sources:

```bash
apify run --input '{
  "searchQuery": "CF10",
  "searchType": "postcode",
  "enrichSources": ["companiesHouse", "landRegistry", "rightmove", "linkedin"],
  "maxResults": 50,
  "outputFormat": "json"
}'
```

### Deploy to Apify

```bash
apify push
```

-----

## Input Schema

|Field          |Type                                 |Required|Description                                     |
|---------------|-------------------------------------|--------|------------------------------------------------|
|`searchQuery`  |`string`                             |✅       |Company name, UK postcode, or director full name|
|`searchType`   |`"company" | "postcode" | "director"`|✅       |How to interpret the search query               |
|`enrichSources`|`string[]`                           |✅       |Which modules to run — see options below        |
|`maxResults`   |`number`                             |❌       |Max leads to return (default: `50`)             |
|`outputFormat` |`"json" | "csv"`                     |❌       |Dataset export format (default: `"json"`)       |

**`enrichSources` options**: `"companiesHouse"`, `"landRegistry"`, `"rightmove"`, `"linkedin"`

> Always include `"companiesHouse"` — it seeds every other module.

-----

## Output Schema

Each enriched record is a flat `LeadRecord` object:

```typescript
{
  // Identity
  leadId: string                  // UUID — generated at merge time
  companyName: string
  registrationNumber: string      // Companies House number — dedup key
  sicCode: string                 // e.g. "68100"
  companyStatus: string           // "active" | "dissolved"

  // Director
  directorName: string
  directorAppointedOn: string

  // Address
  registeredAddress: string
  postcode: string

  // Land Registry
  totalTransactions: number
  lastTransactionDate: string
  estimatedPortfolioValue: number // sum of all price paid values
  propertyTypes: string[]         // ["terraced", "flat", ...]

  // Listings
  activeListings: number
  listingUrls: string[]

  // LinkedIn
  linkedInUrl: string | null
  linkedInRole: string | null
  linkedInCompany: string | null

  // CRM metadata
  outreachStatus: "new" | "contacted" | "responded" | "converted" | "dead"
  enrichedAt: string              // ISO 8601 timestamp
  sources: string[]               // modules that contributed data
}
```

-----

## Source Modules

### Companies House

- **API**: `https://api.company-information.service.gov.uk`
- **Auth**: API key (Basic auth)
- **Rate limit**: 600 requests / 5 min
- Filters on property SIC codes: `68100`, `68209`, `68320`, `41100`

### Land Registry

- **API**: `https://landregistry.data.gov.uk/data/ppi`
- **Auth**: None required
- Queries by company name or postcode; sums `pricePaid` for portfolio value estimate

### Rightmove / Zoopla

- **Method**: `PlaywrightCrawler` (full browser — JS rendering required)
- **Proxy**: Apify residential proxies (mandatory)
- Randomised delays: 2–5s · Max 3 pages per run

### LinkedIn

- **Method**: `CheerioCrawler` (public profile pages only — no login)
- **Proxy**: Apify residential proxies (mandatory)
- Hard cap: 30 lookups per run · Min 3s delay between requests

-----

## Proxy Strategy

|Source            |Proxy       |Type        |
|------------------|------------|------------|
|Companies House   |❌ Not needed|Official API|
|Land Registry     |❌ Not needed|Official API|
|Rightmove / Zoopla|✅ Required  |Residential |
|LinkedIn          |✅ Required  |Residential |

Apify’s residential proxies are used automatically when `APIFY_PROXY_PASSWORD` is present. Locally, scraping modules will fall back to direct requests (expect blocks on LinkedIn/Rightmove).

-----

## Cost Estimate

Based on the **Starter plan ($29/month)**:

|Component                  |Cost per 50 leads|
|---------------------------|-----------------|
|Compute units (Playwright) |~$0.80           |
|Residential proxy          |~$0.50           |
|Datacenter proxy (fallback)|~$0.10           |
|Storage / transfer         |~$0.05           |
|**Total**                  |**~$1.45**       |

At $1.45/run, the $29 Starter plan comfortably covers **~20 runs/month (~1,000 leads/month)**.

-----

## Webhook Integration

On run completion, Apify fires a `POST` to your configured webhook endpoint:

```
POST /api/leads/ingest
Authorization: Bearer {WEBHOOK_SECRET}

{
  "actorRunId": "...",
  "datasetId": "...",
  "status": "SUCCEEDED"
}
```

The receiver fetches the dataset via the Apify API and upserts records into PostgreSQL keyed on `registrationNumber`. Configure the webhook URL in **Apify Console → Actor → Webhooks**.

-----

## Scheduling

Configured to run weekly via Apify Console:

- **Cron**: `0 8 * * 1` (Monday 08:00 UTC)
- **Input**: Cardiff + surrounding postcodes, rotated weekly
- **Alert**: Email notification on failed run

-----

## Project Structure

```
/src
  main.ts               ← Orchestrator / Actor entry point
  companiesHouse.ts     ← Companies House API module
  landRegistry.ts       ← Land Registry HMLR API module
  propertyListings.ts   ← Rightmove / Zoopla scraper
  linkedin.ts           ← LinkedIn public profile scraper
  merge.ts              ← Merges partial source records into LeadRecord
  types.ts              ← Shared TypeScript interfaces
INPUT_SCHEMA.json       ← Apify input schema
Dockerfile
apify.json
CLAUDE.md               ← AI assistant context
PROGRESS.md             ← Build tracker / project board
PROJECT_OUTLINE.md      ← Full architecture and planning doc
README.md               ← This file
```

-----

## Roadmap

- [ ] Email finder module (Hunter.io) — auto-find director email from company domain
- [ ] Companies House filing history — filter dormant companies
- [ ] Confidence score (0–100) based on source coverage per lead
- [ ] Google Maps module — verify company has active physical presence
- [ ] Publish to Apify Store with pay-per-result pricing

-----

## Legal & Compliance

- **Companies House** and **Land Registry** data is publicly available under the [Open Government Licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)
- Rightmove and LinkedIn scraping is limited to **publicly accessible pages** with no login, rate-limited, and used solely for internal lead qualification purposes
- Data is processed under LoyalLeads LTD’s GDPR obligations — not sold or shared with third parties

-----

## Contributing

This is a private internal tool for LoyalLeads LTD. If you’re working on this repo, read `CLAUDE.md` first for conventions and `PROGRESS.md` for current build status.