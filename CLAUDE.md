# CLAUDE.md

> This file provides context and instructions for Claude (or any AI assistant) working on this codebase.

-----

## Project Overview

This is an **Apify Actor** built in **Node.js / TypeScript** that performs multi-source lead enrichment for UK property investors. It takes a seed input (company name, postcode, or director name) and returns a fully enriched lead record by aggregating data from Companies House, Land Registry, Rightmove/Zoopla, and LinkedIn.

The Actor is designed to feed leads into a CRM (PostgreSQL via TrueStage) and trigger cold outreach workflows.

-----

## Tech Stack

- **Runtime**: Node.js 20 + TypeScript
- **Scraping**: Apify SDK (`apify`), Crawlee (`crawlee`)
- **Browser automation**: Playwright (for JS-heavy pages like Rightmove)
- **Light scraping**: Cheerio (for public LinkedIn profiles)
- **APIs**: Companies House REST API, HMLR Price Paid Data API (both free, no auth scraping)
- **Storage**: Apify Dataset (output), Apify Key-Value Store (deduplication)
- **Deployment**: Apify Cloud

-----

## Repo Structure

```
/src
  main.ts               ← Actor entry point / orchestrator
  companiesHouse.ts     ← Companies House API module
  landRegistry.ts       ← Land Registry HMLR API module
  propertyListings.ts   ← Rightmove / Zoopla scraper module
  linkedin.ts           ← LinkedIn public profile scraper
  merge.ts              ← Merges all source outputs into unified lead record
  types.ts              ← Shared TypeScript interfaces and enums
INPUT_SCHEMA.json       ← Apify input schema definition
Dockerfile              ← Apify-compatible Docker config
apify.json              ← Actor metadata
CLAUDE.md               ← This file
PROGRESS.md             ← Build progress tracker
PROJECT_OUTLINE.md      ← Full project plan and architecture
```

-----

## Key Conventions

- Each data source is a **standalone async module** that accepts a seed object and returns a partial `LeadRecord`
- All modules are called in **parallel** via `Promise.allSettled()` in `main.ts` — a failing source must never crash the whole run
- The `merge.ts` function combines partial records into a single flat `LeadRecord` and handles nulls gracefully
- Use `Actor.pushData()` for output — never write to files directly
- Use `Actor.getInput()` at the top of `main.ts` — never hardcode inputs
- Use `Actor.setStatusMessage()` at key checkpoints for visibility in Apify Console

-----

## Anti-Blocking Rules

- **Companies House + Land Registry**: No proxies needed — official APIs
- **Rightmove / Zoopla**: Always use `PlaywrightCrawler` with Apify residential proxies + randomised delays (2–5s)
- **LinkedIn**: Residential proxies only, max 20–30 lookups per run, public pages only (no login)
- Add exponential backoff retry logic for all HTTP requests
- Never hardcode a User-Agent — rotate via Crawlee’s built-in fingerprinting

-----

## Environment Variables / Secrets

|Key                      |Purpose                                                                             |
|-------------------------|------------------------------------------------------------------------------------|
|`COMPANIES_HOUSE_API_KEY`|Companies House REST API key (get from developer.company-information.service.gov.uk)|
|`APIFY_PROXY_PASSWORD`   |Auto-injected by Apify at runtime — do not hardcode                                 |

Store secrets in **Apify Console → Actor → Environment Variables**, never in code or `.env` committed to git.

-----

## Running Locally

```bash
npm install
npx apify run --input '{"searchQuery":"Cardiff","searchType":"postcode","enrichSources":["companiesHouse","landRegistry"],"maxResults":10}'
```

Requires Apify CLI: `npm install -g apify-cli`

-----

## Output Schema

Each run pushes records to an Apify Dataset. Each record follows the `LeadRecord` interface defined in `src/types.ts`. Key fields:

- `leadId` — UUID generated at merge time
- `companyName`, `registrationNumber`, `sicCode` — from Companies House
- `directorName`, `registeredAddress` — from Companies House officers endpoint
- `totalTransactions`, `lastTransactionDate`, `estimatedPortfolioValue` — from Land Registry
- `activeListings` — from Rightmove/Zoopla
- `linkedInUrl`, `linkedInRole` — from LinkedIn
- `outreachStatus` — defaults to `"new"`, updated externally by CRM
- `enrichedAt`, `sources` — metadata

-----

## Integration with TrueStage

On run completion, a **webhook** fires to a TrueStage Next.js API route (`/api/leads/ingest`) which:

1. Receives the Apify dataset export
1. Upserts records into PostgreSQL (keyed on `registrationNumber`)
1. Triggers the outreach sequence via the nurturing framework

-----

## Notes for AI Assistants

- Always check `PROGRESS.md` before starting work to understand what’s built vs. pending
- Do not modify `INPUT_SCHEMA.json` structure without updating `types.ts` to match
- When adding a new source module, register it in `main.ts` orchestrator AND add its toggle to `INPUT_SCHEMA.json`
- Prefer `async/await` over `.then()` chains throughout
- All modules should export a single named async function as their public interface