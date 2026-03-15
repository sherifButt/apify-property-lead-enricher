# PROJECT_OUTLINE.md

# UK Property Investor Lead Enrichment — Apify Actor

**Repo**: `apify-property-lead-enricher`
**Owner**: Sherif / LoyalLeads LTD
**Stack**: Node.js + TypeScript, Apify SDK, Crawlee
**Last Updated**: 2026-03-15

-----

## Problem Statement

Identifying and contacting active UK property investors at scale requires data that’s spread across four separate sources — company filings, transaction history, active listings, and professional profiles. Manually cross-referencing these is slow and doesn’t scale. This Actor automates the full enrichment pipeline in a single run.

-----

## Goal

Given a seed input (company name, postcode, or director name), automatically enrich it into a complete lead record by pulling from:

- Companies House — company identity + directors
- Land Registry — transaction history + portfolio value
- Rightmove / Zoopla — active listings
- LinkedIn — professional profile for personalised outreach

Output a structured, CRM-ready JSON record pushed to an Apify Dataset and synced to TrueStage’s PostgreSQL database via webhook.

-----

## Architecture

```
INPUT
  └─ searchQuery (company name | postcode | director name)
  └─ searchType
  └─ enrichSources[]
  └─ maxResults

        │
        ▼
┌─────────────────────┐
│   main.ts           │  ← Actor entry point
│   Orchestrator      │
└──────┬──────────────┘
       │
       ├──── companiesHouse.ts  ──► Companies House REST API
       │                             company search + officers
       │
       ├──── landRegistry.ts   ──► HMLR Price Paid Data API
       │                             transactions + portfolio value
       │
       ├──── propertyListings.ts ─► Rightmove / Zoopla (Playwright)
       │                             active listings + agent name match
       │
       └──── linkedin.ts        ──► LinkedIn public profiles (Cheerio)
                                     role + URL for outreach personalisation

        │
        ▼
┌─────────────────────┐
│   merge.ts          │  ← Combines all partial records
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐     ┌──────────────────────────┐
│  Apify Dataset      │────►│  TrueStage Webhook        │
│  (JSON/CSV export)  │     │  /api/leads/ingest        │
└─────────────────────┘     └──────────┬───────────────┘
                                        │
                                        ▼
                             ┌──────────────────────┐
                             │  PostgreSQL (Hetzner) │
                             │  leads table          │
                             └──────────────────────┘
```

-----

## Input Schema

```json
{
  "searchQuery": "string",
  "searchType": "company" | "postcode" | "director",
  "maxResults": "number (default: 50)",
  "enrichSources": ["companiesHouse", "landRegistry", "rightmove", "linkedin"],
  "outputFormat": "json" | "csv"
}
```

-----

## Output Schema (`LeadRecord`)

```typescript
interface LeadRecord {
  // Identity
  leadId: string;                     // UUID generated at merge
  companyName: string;
  registrationNumber: string;         // Companies House number — dedup key
  sicCode: string;                    // e.g. "68100" = buying/selling own real estate
  companyStatus: string;              // "active" | "dissolved" etc.

  // Director
  directorName: string;
  directorAppointedOn: string;

  // Address
  registeredAddress: string;
  postcode: string;

  // Land Registry
  totalTransactions: number;
  lastTransactionDate: string;
  estimatedPortfolioValue: number;    // sum of price paid across all transactions
  propertyTypes: string[];            // ["terraced", "flat", "semi-detached"]

  // Listings
  activeListings: number;
  listingUrls: string[];

  // LinkedIn
  linkedInUrl: string | null;
  linkedInRole: string | null;
  linkedInCompany: string | null;

  // CRM metadata
  outreachStatus: "new" | "contacted" | "responded" | "converted" | "dead";
  enrichedAt: string;                 // ISO timestamp
  sources: string[];                  // which modules contributed data
}
```

-----

## Source Module Specs

### 1. Companies House (`companiesHouse.ts`)

**API**: `https://api.company-information.service.gov.uk`
**Auth**: Basic auth with API key
**Rate limit**: 600 requests/5 mins (generous)

Endpoints used:

- `GET /search/companies?q={query}` — find company by name
- `GET /company/{company_number}` — full company profile
- `GET /company/{company_number}/officers` — directors list

Property SIC codes to filter on:

- `68100` — Buying and selling of own real estate
- `68209` — Other letting and operating of own or leased real estate
- `68320` — Management of real estate on a fee or contract basis
- `41100` — Development of building projects

-----

### 2. Land Registry (`landRegistry.ts`)

**API**: `https://landregistry.data.gov.uk/data/ppi`
**Auth**: None required
**Format**: JSON-LD / SPARQL endpoint

Query by company name or postcode to pull:

- Price paid per transaction
- Property address and type
- Transaction date

Derive `estimatedPortfolioValue` by summing all `pricePaid` values per company.

-----

### 3. Rightmove / Zoopla (`propertyListings.ts`)

**Method**: `PlaywrightCrawler` (JavaScript rendering required)
**Proxy**: Apify residential proxies

Flow:

1. Search Rightmove by agent/landlord name derived from Companies House output
1. Count active listings
1. Extract property type distribution
1. Attempt name match back to director name for confidence scoring

Delays: randomise between 2000–5000ms per request.
Max pages per run: 3 (to limit compute units).

-----

### 4. LinkedIn (`linkedin.ts`)

**Method**: `CheerioCrawler` (public pages, no login)
**Proxy**: Apify residential proxies (mandatory)

Search query: `"{directorName}" property investor site:linkedin.com`
Extract from public profile page:

- Profile URL
- Current headline / role
- Current company

Hard limits:

- Max 30 lookups per Actor run
- 3s minimum delay between requests
- Skip if director name is too common (< 3 words)

-----

## Proxy Strategy Summary

|Source          |Proxy Required|Type       |Notes                     |
|----------------|--------------|-----------|--------------------------|
|Companies House |No            |—          |Official API              |
|Land Registry   |No            |—          |Official API              |
|Rightmove/Zoopla|Yes           |Residential|PlaywrightCrawler         |
|LinkedIn        |Yes           |Residential|CheerioCrawler, 30/run max|

-----

## Cost Estimate (Apify)

|Component                               |Est. Cost per 50 leads|
|----------------------------------------|----------------------|
|Compute units (PlaywrightCrawler)       |~$0.80                |
|Residential proxy (Rightmove + LinkedIn)|~$0.50                |
|Datacenter proxy (fallback)             |~$0.10                |
|Storage / data transfer                 |~$0.05                |
|**Total per run (50 leads)**            |**~$1.45**            |

On the **Starter plan ($29/mo)**, this gives ~20 runs/month = 1,000 enriched leads/month comfortably within budget.

-----

## Integration: TrueStage Webhook

On Actor run completion, Apify fires a POST webhook to:

```
POST https://truestage.co.uk/api/leads/ingest
Authorization: Bearer {WEBHOOK_SECRET}
```

Payload:

```json
{
  "actorRunId": "...",
  "datasetId": "...",
  "status": "SUCCEEDED"
}
```

The Next.js handler then calls `Actor.openDataset(datasetId).getData()` via the Apify API and upserts each record into PostgreSQL keyed on `registrationNumber`.

-----

## Scheduling

- **Frequency**: Weekly, Monday 08:00 UTC
- **Cron**: `0 8 * * 1`
- **Input**: Cardiff + surrounding postcodes rotated weekly
- **Alert**: Email on failed run (configured in Apify Console)

-----

## Build Phases

|Phase    |Description             |Est. Time     |
|---------|------------------------|--------------|
|1        |Repo scaffolding + types|1–2 hrs       |
|2        |Companies House module  |2–3 hrs       |
|3        |Land Registry module    |2 hrs         |
|4        |Rightmove/Zoopla scraper|3–4 hrs       |
|5        |LinkedIn scraper        |2–3 hrs       |
|6        |Orchestrator + merge    |2 hrs         |
|7        |Webhook + DB integration|2 hrs         |
|8        |Scheduling + monitoring |1 hr          |
|**Total**|                        |**~15–17 hrs**|

-----

## Future Enhancements

- Add **email finder** module (Hunter.io API) to auto-find director email from company domain
- Add **Companies House filing history** to detect recent activity (dormant company filter)
- Build a **confidence score** (0–100) based on how many sources returned data
- Expose Actor on **Apify Store** with pay-per-result pricing once stable
- Add **Google Maps** module to check if company has a physical office listing